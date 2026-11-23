import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { Readable } from "node:stream";
import { dataPath } from "@/lib/data-path";
import { MEDIA_FILENAME, MEDIA_TYPES } from "@/lib/storage";

type Context = { params: Promise<{ filename: string }> };

function stream(path: string, start: number, end: number) {
  return Readable.toWeb(createReadStream(path, { start, end })) as unknown as ReadableStream;
}

async function serve(request: Request, { params }: Context, head: boolean) {
  const { filename } = await params;
  if (!MEDIA_FILENAME.test(filename)) return new Response("Ikke funnet", { status: 404 });
  const path = dataPath("uploads", filename);
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) return new Response("Ikke funnet", { status: 404 });

  const size = info.size;
  const headers = new Headers({
    "Content-Type": MEDIA_TYPES[extname(filename)]?.mime || "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Last-Modified": info.mtime.toUTCString(),
  });

  const range = request.headers.get("range");
  const match = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && match && (match[1] || match[2])) {
    let start: number;
    let end: number;
    if (match[1]) {
      start = Number(match[1]);
      end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    } else {
      // «bytes=-500» betyr de siste 500 bytene.
      start = Math.max(0, size - Number(match[2]));
      end = size - 1;
    }
    if (start >= size || start > end) {
      headers.set("Content-Range", `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    headers.set("Content-Length", String(end - start + 1));
    return new Response(head ? null : stream(path, start, end), { status: 206, headers });
  }

  headers.set("Content-Length", String(size));
  return new Response(head || size === 0 ? null : stream(path, 0, size - 1), { status: 200, headers });
}

export function GET(request: Request, context: Context) {
  return serve(request, context, false);
}

export function HEAD(request: Request, context: Context) {
  return serve(request, context, true);
}
