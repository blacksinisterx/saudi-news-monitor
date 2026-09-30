// End-to-end check against a RUNNING dev server (npm run dev) with a local mock push service.
// Requires: openssl on PATH, ENABLE_TEST_MODE=true, and the dev server started with NODE_TLS_REJECT_UNAUTHORIZED=0
// (so web-push will accept the mock's self-signed cert):   NODE_TLS_REJECT_UNAUTHORIZED=0 npm run dev
import { execSync } from "node:child_process";
import { createECDH, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const APP = process.env.APP_URL ?? "http://localhost:3000";
const dir = mkdtempSync(join(tmpdir(), "snm-"));
execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 1 -subj "/CN=localhost"`, { cwd: dir, stdio: "ignore" });

const received: { path: string; auth?: string; enc?: string; bytes: number }[] = [];
const mock = createServer({ key: readFileSync(join(dir, "key.pem")), cert: readFileSync(join(dir, "cert.pem")) }, (req, res) => {
  let n = 0;
  req.on("data", (c) => (n += c.length));
  req.on("end", () => {
    received.push({ path: req.url!, auth: req.headers.authorization, enc: req.headers["content-encoding"] as string, bytes: n });
    res.writeHead(201).end();
  });
});
await new Promise<void>((r) => mock.listen(9443, r));

const b64u = (b: Buffer) => b.toString("base64url");
const ecdh = createECDH("prime256v1");
ecdh.generateKeys();
const endpoint = `https://localhost:9443/push/${randomUUID()}`;
let cookie = "";
const api = async (path: string, body?: unknown, method = "POST") => {
  const r = await fetch(APP + path, { method, headers: { "Content-Type": "application/json", Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) as Record<string, any> };
};

try {
  // 1. login
  const fd = new URLSearchParams({ password: process.env.APP_PASSWORD ?? "dev-password-123" });
  const login = await fetch(APP + "/api/login", { method: "POST", body: fd, redirect: "manual" });
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
  assert.ok(cookie.startsWith("sm_session="), "login failed (check APP_PASSWORD)");
  assert.equal((await fetch(APP + "/api/push/prefs", { redirect: "manual" })).status, 401, "API must reject unauthenticated calls");

  // 2. subscribe (a real, well-formed subscription pointing at the mock push service)
  const sub = await api("/api/push/subscribe", { endpoint, keys: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(randomBytes(16)) } });
  assert.equal(sub.status, 200, JSON.stringify(sub.json));
  assert.equal((await api("/api/push/subscribe", { endpoint: "http://insecure.example/x", keys: { p256dh: "x".repeat(30), auth: "y".repeat(10) } })).status, 400, "http endpoints must be rejected");
  const prefs = await api("/api/push/prefs", { endpoint, prefs: { level: "high", categories: [], quiet: { enabled: false, start: "23:00", end: "07:00", tz: "Asia/Riyadh", allowCritical: true } } });
  assert.equal(prefs.status, 200, JSON.stringify(prefs.json));

  // 3. inject the demo scenario: Reuters -> Al Jazeera -> SPA
  const inj = await api("/api/test/inject", { scenario: "demo", reset: true });
  assert.equal(inj.status, 200, JSON.stringify(inj.json));
  const ids = new Set(inj.json.results.map((r: any) => r.eventId));
  assert.equal(ids.size, 1, `3 articles must cluster into ONE event, got ${[...ids]}`);
  const perArticle = inj.json.results.map((r: any) => r.notified);
  console.log("pushes sent per injected article:", perArticle);
  assert.deepEqual(perArticle, [1, 0, 1], "expected: push on first report, silence on duplicate coverage, UPDATE when SPA confirms");
  assert.equal(received.length, 2);
  for (const r of received) { assert.ok(r.auth?.startsWith("vapid "), "VAPID auth header"); assert.equal(r.enc, "aes128gcm"); assert.ok(r.bytes > 100); }

  // 4. dashboard + detail page show it
  const eventId = [...ids][0];
  const page = await (await fetch(`${APP}/events/${eventId}`, { headers: { Cookie: cookie } })).text();
  for (const s of ["CONFIRMED", "Reuters (test)", "Al Jazeera (test)", "SPA (test)", "CRITICAL", "3 independent sources"]) assert.ok(page.includes(s), `event page missing "${s}"`);
  const home = await (await fetch(APP + "/", { headers: { Cookie: cookie } })).text();
  assert.ok(home.includes(`/events/${eventId}`), "event missing from dashboard");

  // 5. a second injection of the same story must not push again
  const again = await api("/api/test/inject", { kind: "other", title: "Saudi air defenses intercept missiles, another outlet reports" });
  console.log("duplicate coverage from a 4th outlet -> pushes:", again.json.results[0].notified);
  assert.equal(again.json.results[0].notified, 0);

  console.log("\nE2E PASSED: article -> event -> summary -> verification -> push (x2) -> dashboard");
} finally {
  await api("/api/push/subscribe", { endpoint }, "DELETE").catch(() => {}); // always remove the mock subscription
  mock.close();
}
process.exit(0);
