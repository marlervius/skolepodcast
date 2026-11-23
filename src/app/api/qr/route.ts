import QRCode from "qrcode";

export async function GET(request: Request) {
  const value = new URL(request.url).searchParams.get("url") || "";
  if (!value || value.length > 1000) return new Response("Mangler gyldig url", { status: 400 });
  const svg = await QRCode.toString(value, {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#1A1917", light: "#FFFFFF" },
  });
  return new Response(svg, {
    headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=86400" },
  });
}
