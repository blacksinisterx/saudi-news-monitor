import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Public, minimal: safe for an uptime monitor. Detailed view is /status (login required).
export async function GET() {
  try {
    const [r] = await sql`select extract(epoch from now() - max(last_success_at))::int as age, count(*) filter (where consecutive_failures = 0) as ok, count(*) as total from sources where enabled and not is_test`;
    const healthy = r.age !== null && r.age < 600;
    return NextResponse.json({ ok: healthy, lastSuccessfulFetchAgeSec: r.age, sourcesOk: Number(r.ok), sourcesTotal: Number(r.total) }, { status: healthy ? 200 : 503 });
  } catch {
    return NextResponse.json({ ok: false, error: "db" }, { status: 503 });
  }
}
