import QRCode from "qrcode";
import { normalizeCode } from "@/lib/types";

/** QR-kode til elevlenken for et fagrom. Lenken bygges her, så ruten kan ikke brukes til å lage koder til andre sider. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = normalizeCode(url.searchParams.get("code"));
  if (!code) return new Response("Mangler klassekode", { status: 400 });
  const link = new URL(`/fag/${encodeURIComponent(code)}`, url.origin).href;
  const svg = await QRCode.toString(link, {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#1A1917", light: "#FFFFFF" },
  });
  return new Response(svg, {
    headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=86400" },
  });
}
