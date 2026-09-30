import webpush from "web-push";
import { sql } from "./db";
import { buildPush, publisherNames, wantsEvent, type Prefs, type PushEvent, type Stage } from "./pipeline";
import { log } from "./log";

let ready = false;
export function pushConfigured(): boolean {
  if (ready) return true;
  const { VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv, VAPID_SUBJECT: subj } = process.env;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(subj || "mailto:admin@example.com", pub, priv);
  return (ready = true);
}

type Sub = { id: number; endpoint: string; p256dh: string; auth: string; prefs: Prefs };

async function send(sub: Sub, payload: object): Promise<{ ok: true } | { ok: false; gone: boolean; error: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), { TTL: 3600, urgency: "high", timeout: 8000 });
      return { ok: true };
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) return { ok: false, gone: true, error: `HTTP ${status}` };
      const retryable = !status || status === 429 || status >= 500;
      if (attempt === 0 && retryable) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      return { ok: false, gone: false, error: `${status ?? "network"}: ${(e as Error).message}`.slice(0, 200) };
    }
  }
  return { ok: false, gone: false, error: "unreachable" };
}

/** Deliver a specific payload to one subscription (used by the "send test push" button). */
export async function sendRaw(subId: number, payload: object) {
  const [sub] = await sql<Sub[]>`select id, endpoint, p256dh, auth, prefs from push_subscriptions where id = ${subId}`;
  return sub ? send(sub, payload) : { ok: false as const, gone: true, error: "not found" };
}

const MAX_AGE_MS = 3 * 3600_000; // never notify about stale items (e.g. first run backfill)

/**
 * Notify for one event. At most one message per (event, subscription, stage).
 * If nothing was sent yet the first message carries the current verification state; later transitions
 * (confirmed / conflicting) send a single UPDATE.
 */
export async function notifyEvent(eventId: number, opts: { ignoreAge?: boolean } = {}) {
  if (!pushConfigured()) return { sent: 0, failed: 0, skipped: "vapid not configured" };
  const [e] = await sql`
    select e.*, (select max(a.published_at) from event_sources es join articles a on a.id = es.article_id where es.event_id = e.id) as newest,
           (select array_agg(distinct a.publisher) from event_sources es join articles a on a.id = es.article_id where es.event_id = e.id) as source_names
    from events e where e.id = ${eventId}`;
  if (!e) return { sent: 0, failed: 0 };
  if (!opts.ignoreAge && !e.is_test && Date.now() - new Date(e.newest).getTime() > MAX_AGE_MS) return { sent: 0, failed: 0, skipped: "stale" };

  const stagesNow: Stage[] = ["initial"];
  if (e.verification === "CONFIRMED") stagesNow.push("confirmed");
  if (e.verification === "CONFLICTING") stagesNow.push("conflict");

  const subs = await sql<Sub[]>`select id, endpoint, p256dh, auth, prefs from push_subscriptions`;
  const done = await sql`select subscription_id, stage, status, attempts, created_at from notifications where event_id = ${eventId}`;
  const pe: PushEvent = {
    id: e.id, headline: e.headline, summary: e.summary, importance: e.importance, verification: e.verification, location: e.location,
    confirmed_facts: e.confirmed_facts, claims: e.claims, sources: publisherNames(e.source_names),
  };
  let sent = 0, failed = 0;
  const now = new Date();

  for (const sub of subs) {
    if (!wantsEvent(sub.prefs, e.importance, e.category, now)) continue;
    const mine = done.filter((d) => d.subscription_id === sub.id);
    const isDone = (st: Stage) => mine.some((d) => d.stage === st && (d.status !== "failed" || d.attempts >= 3 || now.getTime() - new Date(d.created_at).getTime() < 120_000));
    const initialSent = mine.some((d) => d.stage === "initial" && d.status === "sent");
    const pending = stagesNow.filter((s) => !isDone(s));
    if (!pending.length) continue;
    // If the first message is going out now, it already reflects the latest verification: mark later stages as skipped.
    const stage: Stage = initialSent ? pending[pending.length - 1] : "initial";
    const covered = initialSent ? [stage] : pending;

    const r = await send(sub, buildPush(pe, stage, initialSent));
    if (r.ok) {
      sent++;
      for (const st of covered) {
        await sql`insert into notifications (event_id, subscription_id, stage, status) values (${eventId}, ${sub.id}, ${st}, ${st === stage ? "sent" : "skipped"})
                  on conflict (event_id, subscription_id, stage) do update set status = excluded.status, error = null, created_at = now()`;
      }
      await sql`update push_subscriptions set failure_count = 0, last_success_at = now() where id = ${sub.id}`;
    } else if (r.gone) {
      await sql`delete from push_subscriptions where id = ${sub.id}`; // expired/unsubscribed endpoint
      await log("info", "notify", `removed dead subscription ${sub.id} (${r.error})`);
    } else {
      failed++;
      await sql`insert into notifications (event_id, subscription_id, stage, status, error) values (${eventId}, ${sub.id}, ${stage}, 'failed', ${r.error})
                on conflict (event_id, subscription_id, stage) do update set status = 'failed', error = excluded.error, attempts = notifications.attempts + 1, created_at = now()`;
      await sql`update push_subscriptions set failure_count = failure_count + 1 where id = ${sub.id}`;
      await log("warn", "notify", `push failed for sub ${sub.id}: ${r.error}`, { eventId });
    }
  }
  return { sent, failed };
}
