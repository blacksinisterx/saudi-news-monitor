import { NextResponse, after } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runIngest } from "@/lib/ingest";
import { log } from "@/lib/log";

export const maxDuration = 60; // Vercel Hobby cap
export const dynamic = "force-dynamic";

function authorized(req: Request) {
  const want = process.env.CRON_SECRET;
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  return Boolean(want) && got.length === want!.length && timingSafeEqual(Buffer.from(got), Buffer.from(want!));
}

async function passes() {
  const n = Math.min(Number(process.env.INGEST_PASSES ?? 2), 3);
  const out = [];
  const start = Date.now();
  for (let i = 0; i < n; i++) {
    const t0 = Date.now();
    try { out.push(await runIngest()); } catch (e) { out.push({ error: (e as Error).message }); }
    if (i < n - 1) {
      if (Date.now() - start > 30_000) break; // never risk the 60s function cap
      await new Promise((r) => setTimeout(r, Math.max(0, 27_000 - (Date.now() - t0)))); // ~30s cadence inside one cron tick
    }
  }
  return out;
}

// Cron calls this once a minute. Default: respond immediately and work in the background (after()).
// ?sync=1 waits and returns stats (for debugging / npm run cron).
export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (new URL(req.url).searchParams.get("sync")) return NextResponse.json(await passes());
  after(async () => { try { await passes(); } catch (e) { await log("error", "cron", (e as Error).message); } });
  return NextResponse.json({ accepted: true }, { status: 202 });
}
