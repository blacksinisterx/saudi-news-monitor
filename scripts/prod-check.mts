// Verifies on a deployed instance that a NEW critical report in an already-alerted event triggers an UPDATE push.
// Needs APP_URL, APP_PASSWORD, DATABASE_URL (use --env-file=.env.prod) and ENABLE_TEST_MODE=true on the server.
// Sends real (test-labelled) pushes to every subscribed device. Retries a few times while a fresh deploy goes live.
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

// Pretend everything so far happened 70 min ago: alerts AND the articles fetched before them (like real life, old articles are not 'new since the last alert').
const age = async (id: number) => {
  await sql`update notifications set created_at = created_at - interval '70 minutes' where event_id = ${id}`;
  await sql`update articles set fetched_at = fetched_at - interval '70 minutes' where event_id = ${id}`;
};
const pushes = async (title: string, snippet: string) => (await post({ kind: "other", title, snippet })).results?.[0];
let ok = true;
const check = (label: string, got: number | undefined, want: "some" | "none") => {
  const pass = want === "some" ? (got ?? 0) >= 1 : got === 0;
  if (!pass) ok = false;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}: pushes=${got} (expected ${want === "some" ? ">=1" : "0"})`);
};

for (let attempt = 1; attempt <= 5; attempt++) {
  const demo = await post({ scenario: "demo", reset: true });
  const eventId = demo.results?.[0]?.eventId;
  if (!eventId) { console.log(`attempt ${attempt}: ${JSON.stringify(demo)}`); await new Promise((res) => setTimeout(res, 20_000)); continue; }
  await age(eventId);
  check("new place (Riyadh) is news", (await pushes("Saudi air defenses intercept more missiles over Riyadh, another outlet reports", "A second wave."))?.notified, "some");
  await age(eventId);
  check("same place again is NOT news", (await pushes("Saudi air defenses intercept third wave of missiles over Riyadh", "Third wave."))?.notified, "none");
  await age(eventId);
  check("video / condemnation is NOT news", (await pushes("Video shows missile interception over Riyadh, Egypt condemns attack", "Video."))?.notified, "none");
  await age(eventId);
  check("new place + casualties (Jeddah, 12 killed) is news", (await pushes("Missile strike on Jeddah kills 12, Saudi authorities say", "Casualties reported."))?.notified, "some");
  await age(eventId);
  check("repeat of Jeddah report is NOT news", (await pushes("Jeddah missile strike kills 12, Saudi authorities say", "Same."))?.notified, "none");
  await sql`delete from events where is_test`; await sql`delete from articles where source_id in (select id from sources where is_test)`;
  await sql.end();
  console.log(ok ? "PRECISE ALERTS LIVE" : "SOME CHECKS FAILED (deploy may still be rolling out: rerun)");
  process.exit(ok ? 0 : 1);
}
await sql.end();
console.log("could not run");
process.exit(1);
