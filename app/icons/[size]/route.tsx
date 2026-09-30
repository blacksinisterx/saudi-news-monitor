import { ImageResponse } from "next/og";

// Generates the app icon on demand (no binary assets to maintain). /icons/192, /icons/512, /icons/180, /icons/512?maskable=1
export async function GET(req: Request, { params }: { params: Promise<{ size: string }> }) {
  const size = Math.min(Math.max(Number((await params).size) || 192, 64), 1024);
  const maskable = new URL(req.url).searchParams.has("maskable");
  const dot = size * (maskable ? 0.2 : 0.26);
  return new ImageResponse(
    (
      <div style={{ width: size, height: size, background: "#0b6b4f", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: maskable ? 0 : size * 0.22 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
          <div style={{ width: dot, height: dot, borderRadius: dot, background: "#ff5a4f", marginBottom: size * 0.05 }} />
          <div style={{ color: "#fff", fontSize: size * (maskable ? 0.22 : 0.28), fontWeight: 800, letterSpacing: -1 }}>SNM</div>
        </div>
      </div>
    ),
    { width: size, height: size, headers: { "Cache-Control": "public, max-age=604800, immutable" } }
  );
}
