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

for (let attempt = 1; attempt <= 5; attempt++) {
  const demo = await post({ scenario: "demo", reset: true });
  const eventId = demo.results?.[0]?.eventId;
  if (!eventId) { console.log(`attempt ${attempt}: ${JSON.stringify(demo)}`); await new Promise((res) => setTimeout(res, 20_000)); continue; }
  await sql`update notifications set created_at = now() - interval '20 minutes' where event_id = ${eventId}`; // pretend earlier alerts were 20 min ago
  const next = await post({ kind: "other", title: "Saudi air defenses intercept more missiles over Riyadh, another outlet reports", snippet: "A second wave was intercepted." });
  const r = next.results?.[0];
  console.log(`attempt ${attempt}: same event=${r?.eventId === eventId} pushes sent=${r?.notified}`);
  if (r?.eventId === eventId && r.notified >= 1) { console.log("UPDATE PUSH FIX IS LIVE"); await sql.end(); process.exit(0); }
  await new Promise((res) => setTimeout(res, 20_000)); // deploy may still be rolling out
}
await sql.end();
console.log("update push NOT observed");
process.exit(1);
