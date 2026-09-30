import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "@/lib/db";

const Body = z.object({
  endpoint: z.string().url().max(1000).refine((u) => u.startsWith("https://"), "endpoint must be https"),
  keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }),
});

export async function POST(req: Request) {
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "invalid subscription" }, { status: 400 });
  const ua = (req.headers.get("user-agent") ?? "").slice(0, 200);
  const [row] = await sql`
    insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
    values (1, ${p.data.endpoint}, ${p.data.keys.p256dh}, ${p.data.keys.auth}, ${ua})
    on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent, failure_count = 0
    returning id, prefs`;
  return NextResponse.json({ id: Number(row.id), prefs: row.prefs });
}

export async function DELETE(req: Request) {
  const p = z.object({ endpoint: z.string().url().max(1000) }).safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  await sql`delete from push_subscriptions where endpoint = ${p.data.endpoint}`;
  return NextResponse.json({ ok: true });
}
