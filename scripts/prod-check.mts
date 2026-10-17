// Verifies on a deployed instance that ONLY the first (breaking) alert is pushed; follow-ups stay silent.
// Needs APP_PASSWORD + DATABASE_URL (--env-file=.env.prod) and ENABLE_TEST_MODE=true on the server. Sends real test pushes.
import { sql } from "../lib/db";

const APP = process.env.APP_URL ?? "https://saudi-news-monitor.vercel.app";
const login = await fetch(`${APP}/api/login`, { method: "POST", body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? "" }), redirect: "manual" });
const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
if (!cookie.startsWith("sm_session=")) throw new Error("login failed");
const post = async (body: unknown): Promise<any> => {
  const r = await fetch(`${APP}/api/test/inject`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body) });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { error: `HTTP ${r.status}: ${t.slice(0, 60)}` }; }
};
let ok = true;
const check = (label: string, got: number | undefined, want: "some" | "none") => {
  const pass = want === "some" ? (got ?? 0) >= 1 : got === 0;
  if (!pass) ok = false;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}: pushes=${got} (expected ${want === "some" ? ">=1" : "0"})`);
};

const demo = await post({ scenario: "demo", reset: true }); // Reuters -> Al Jazeera -> SPA confirms
const n = (demo.results ?? []).map((r: any) => r.notified);
check("first report of a new event = BREAKING push", n[0], "some");
check("duplicate coverage = silent", n[1], "none");
check("official confirmation (SPA) = silent, read in app", n[2], "none");
const fire = await post({ kind: "wire", title: "Fire at Aramco refinery in Ras Tanura after attack", snippet: "Smoke seen over the facility." });
check("a different new incident = BREAKING push", fire.results?.[0]?.notified, "some");
const more = await post({ kind: "other", title: "Aramco says fire at Ras Tanura refinery is under control", snippet: "Fire contained." });
check("follow-up on the same incident = silent", more.results?.[0]?.notified, "none");
await sql`delete from events where is_test`; await sql`delete from articles where source_id in (select id from sources where is_test)`;
await sql.end();
console.log(ok ? "BREAKING-ONLY ALERTS LIVE" : "SOME CHECKS FAILED (deploy may still be rolling out: rerun)");
process.exit(ok ? 0 : 1);
