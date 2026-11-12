import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { z } from "zod";
import { db } from "@/server/db";
import { assertLocalRequest, AppError } from "@/server/security";
import { mediaPath } from "@/server/media";
import { handleApi } from "@/server/api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handleApi(request, ["media", (await context.params).id]);
}
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertLocalRequest(request);
    const id = z
        .string()
        .uuid()
        .parse((await context.params).id),
      media = await db.media.findUnique({ where: { id } });
    if (!media) return new Response("Media tidak ditemukan.", { status: 404 });
    const file = mediaPath(id),
      info = await stat(file),
      range = request.headers.get("range");
    let start = 0,
      end = info.size - 1,
      status = 200;
    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (!match)
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${info.size}` },
        });
      start = Number(match[1]);
      end = match[2] ? Number(match[2]) : end;
      status = 206;
      if (start > end || end >= info.size)
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${info.size}` },
        });
    }
    const headers: Record<string, string> = {
      "Content-Type": media.mime,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      "Content-Disposition": "inline",
    };
    if (status === 206)
      headers["Content-Range"] = `bytes ${start}-${end}/${info.size}`;
    return new Response(
      Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream,
      { status, headers },
    );
  } catch (error) {
    return new Response("Media tidak tersedia.", {
      status: error instanceof AppError ? error.status : 404,
    });
  }
}
