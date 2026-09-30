import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, validSession } from "@/lib/auth";

// Public: login, PWA assets, health probe, and the cron endpoint (which checks its own bearer secret).
const PUBLIC = [/^\/login$/, /^\/api\/login$/, /^\/manifest\.webmanifest$/, /^\/sw\.js$/, /^\/offline\.html$/, /^\/icons\//, /^\/api\/health$/, /^\/api\/cron\//];

// ponytail: in-memory per-instance limiter (serverless instances don't share it). Upgrade: Upstash Redis free tier.
const hits = new Map<string, number[]>();
function limited(key: string, max: number, windowMs = 60_000): boolean {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > max;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";

  if (pathname === "/api/login" && limited(`login:${ip}`, 5)) return new NextResponse("Too many attempts", { status: 429 });
  if (pathname.startsWith("/api/") && !pathname.startsWith("/api/cron/") && limited(`api:${ip}`, 120)) return new NextResponse("Rate limited", { status: 429 });
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();

  if (await validSession(req.cookies.get(COOKIE)?.value)) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
