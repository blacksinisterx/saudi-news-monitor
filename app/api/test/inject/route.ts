import { NextResponse } from "next/server";
import { z } from "zod";
import { DEMO_SCENARIO, injectTest } from "@/lib/ingest";
import { sql } from "@/lib/db";

export const maxDuration = 60;

const Body = z.union([
  z.object({ scenario: z.literal("demo"), reset: z.boolean().optional() }),
  z.object({ kind: z.enum(["official", "wire", "media", "other"]), title: z.string().min(5).max(200), snippet: z.string().max(300).optional() }),
]);

export async function POST(req: Request) {
  if (process.env.ENABLE_TEST_MODE !== "true") return NextResponse.json({ error: "test mode disabled (ENABLE_TEST_MODE=true)" }, { status: 403 });
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  // reset: wipe earlier test data so the demo starts from a clean slate (real events are never touched)
  if ("reset" in p.data && p.data.reset) {
    await sql`delete from events where is_test`;
    await sql`delete from articles where source_id in (select id from sources where is_test)`;
  }
  const items = "scenario" in p.data ? DEMO_SCENARIO : [p.data];
  return NextResponse.json({ results: await injectTest(items) });
}
