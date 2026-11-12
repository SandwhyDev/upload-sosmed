import { config } from "dotenv";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
config({ path: ".env.local", quiet: true });
process.env.NEXT_TELEMETRY_DISABLED = "1";
process.env.CHECKPOINT_DISABLE = "1";
const localUrl = "postgresql://ruang:ruang-local@127.0.0.1:55432/ruang_konten";
const useEmbedded = !process.env.DATABASE_URL;
process.env.DATABASE_URL ||= localUrl;
const children = [];
let embedded;
let stopping = false;
const pgLogs = [];
function run(file, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file, ...args], {
      stdio: "inherit",
      env: process.env,
      windowsHide: true,
    });
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Command failed (${code})`)),
    );
    child.on("error", reject);
  });
}
async function reachable() {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 1500,
  });
  try {
    await client.connect();
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}
try {
  if (useEmbedded && !(await reachable())) {
    const { default: EmbeddedPostgres } = await import("embedded-postgres");
    const databaseDir = path.resolve(".data/postgres");
    await mkdir(".data", { recursive: true });
    embedded = new EmbeddedPostgres({
      databaseDir,
      user: "ruang",
      password: "ruang-local",
      port: 55432,
      persistent: true,
      authMethod: "scram-sha-256",
      postgresFlags: ["-h", "127.0.0.1"],
      onLog: (message) => {
        pgLogs.push(String(message));
        if (pgLogs.length > 12) pgLogs.shift();
      },
      onError: () => {},
    });
    if (!existsSync(path.join(databaseDir, "PG_VERSION"))) {
      console.log("Menyiapkan PostgreSQL lokal pertama kali...");
      await embedded.initialise();
    }
    await embedded.start();
    const client = embedded.getPgClient("postgres", "127.0.0.1");
    await client.connect();
    const exists = await client.query(
      "SELECT 1 FROM pg_database WHERE datname='ruang_konten'",
    );
    if (!exists.rowCount) await client.query("CREATE DATABASE ruang_konten");
    await client.end();
  }
  await run("node_modules/prisma/build/index.js", ["generate"]);
  await run("node_modules/prisma/build/index.js", ["db", "push"]);
  for (const [file, args] of [
    [null, ["--import", "tsx", "src/worker.ts"]],
    ["node_modules/next/dist/bin/next", ["dev", "--hostname", "127.0.0.1"]],
  ]) {
    const child = spawn(process.execPath, [...(file ? [file] : []), ...args], {
      stdio: "inherit",
      env: process.env,
      windowsHide: true,
    });
    children.push(child);
    child.on("error", (error) => {
      console.error(error.message);
      stop(1);
    });
    child.on("exit", (code) => {
      if (!stopping) stop(code || 0);
    });
  }
} catch (error) {
  console.error(
    "Tidak dapat memulai aplikasi:",
    error?.message || "PostgreSQL berhenti sebelum siap.",
  );
  if (pgLogs.length) console.error(pgLogs.join("").slice(-3000));
  console.error(
    "Gunakan PostgreSQL sendiri melalui DATABASE_URL, atau periksa PostgreSQL lokal di .data/postgres.",
  );
  await stop(1);
}
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (process.platform === "win32" && child.pid) {
      await new Promise((resolve) => {
        const killer = spawn(
          "taskkill",
          ["/pid", String(child.pid), "/t", "/f"],
          { windowsHide: true, stdio: "ignore" },
        );
        killer.on("close", resolve);
        killer.on("error", resolve);
      });
    } else child.kill("SIGTERM");
  }
  if (embedded) await embedded.stop().catch(() => {});
  process.exit(code);
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
