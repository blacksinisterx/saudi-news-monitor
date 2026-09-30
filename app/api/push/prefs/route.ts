import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "@/lib/db";
import { CATEGORIES } from "@/lib/pipeline";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const Body = z.object({
  endpoint: z.string().url().max(1000),
  prefs: z.object({
    level: z.enum(["critical", "high", "all"]),
    categories: z.array(z.enum(CATEGORIES as [string, ...string[]])).max(10),
    quiet: z.object({
      enabled: z.boolean(), start: hhmm, end: hhmm, allowCritical: z.boolean().default(true),
      tz: z.string().max(60).refine((t) => { try { new Intl.DateTimeFormat("en", { timeZone: t }); return true; } catch { return false; } }, "bad timezone"),
    }),
  }),
});

async function lookup(endpoint: string) {
  const [row] = await sql`select id, prefs from push_subscriptions where endpoint = ${endpoint}`;
  return row;
}

export async function POST(req: Request) {
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message ?? "invalid" }, { status: 400 });
  const r = await sql`update push_subscriptions set prefs = ${sql.json(p.data.prefs)} where endpoint = ${p.data.endpoint} returning id`;
  return r.length ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "subscription not found" }, { status: 404 });
}

export async function GET(req: Request) {
  const endpoint = new URL(req.url).searchParams.get("endpoint") ?? "";
  const row = endpoint ? await lookup(endpoint) : null;
  return row ? NextResponse.json({ prefs: row.prefs }) : NextResponse.json({ error: "not found" }, { status: 404 });
}
