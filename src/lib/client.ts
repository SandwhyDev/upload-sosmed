export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch("/api/" + path, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(method !== "GET" ? { "X-Ruang-Request": "1" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(method === "GET" ? 30000 : 120000),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("Server belum siap atau koneksi terputus. Coba kembali.");
  }
  if (!response.ok) throw new Error(data.error || "Permintaan belum berhasil.");
  return data as T;
}
export function formatSize(bytes: number) {
  return bytes >= 1024 * 1024
    ? (bytes / 1024 / 1024).toFixed(1) + " MB"
    : Math.ceil(bytes / 1024) + " KB";
}
