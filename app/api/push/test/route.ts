import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "@/lib/db";
import { pushConfigured, sendRaw } from "@/lib/push";

export async function POST(req: Request) {
  const p = z.object({ endpoint: z.string().url().max(1000) }).safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  if (!pushConfigured()) return NextResponse.json({ error: "VAPID keys not configured on the server" }, { status: 500 });
  const [sub] = await sql`select id from push_subscriptions where endpoint = ${p.data.endpoint}`;
  if (!sub) return NextResponse.json({ error: "subscription not found — enable notifications first" }, { status: 404 });
  const r = await sendRaw(Number(sub.id), { title: "🟠 Test — Saudi News Monitor", body: "Push delivery works on this device.", url: "/", tag: "test", critical: false });
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: 502 });
}
