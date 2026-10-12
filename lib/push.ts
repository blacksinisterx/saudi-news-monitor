import webpush from "web-push";
import { sql } from "./db";
import { ALERT_MAX_AGE_MS, DUP_STORYLINE_SIM, UPDATE_GAP_DEVICE_MS, UPDATE_GAP_EVENT_MS, alertWorthy, buildPush, publisherName, publisherNames, similarity, wantsEvent, type Prefs, type PushEvent, type Stage } from "./pipeline";
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


/**
 * Notify for one event. At most one message per (event, subscription, stage).
 * If nothing was sent yet the first message carries the current verification state; later transitions
 * (confirmed / conflicting) send a single UPDATE.
 */
export async function notifyEvent(eventId: number, opts: { ignoreAge?: boolean } = {}) {
  if (!pushConfigured()) return { sent: 0, failed: 0, skipped: "vapid not configured" };
  const [e] = await sql`
    select e.*, (select max(a.published_at) from event_sources es join articles a on a.id = es.article_id where es.event_id = e.id) as newest,
           (select array_agg(distinct a.publisher) from event_sources es join articles a on a.id = es.article_id where es.event_id = e.id) as source_names,
           exists (select 1 from event_sources es join articles a on a.id = es.article_id where es.event_id = e.id and a.role = 'official') as has_official
    from events e where e.id = ${eventId}`;
  if (!e) return { sent: 0, failed: 0 };
  if (!opts.ignoreAge && !e.is_test && Date.now() - new Date(e.newest).getTime() > ALERT_MAX_AGE_MS) return { sent: 0, failed: 0, skipped: "stale" };

  const stagesNow: Stage[] = ["initial"];
  if (e.verification === "CONFIRMED") stagesNow.push("confirmed");
  if (e.verification === "CONFLICTING") stagesNow.push("conflict");

  const subs = await sql<Sub[]>`select id, endpoint, p256dh, auth, prefs from push_subscriptions`;
  const done = await sql`select subscription_id, stage, status, attempts, created_at from notifications where event_id = ${eventId}`;
  // newest CRITICAL article of this event: if it arrived after a device's last alert, that device gets an UPDATE (queued, never dropped)
  const [crit] = await sql`select id, title, publisher, fetched_at, published_at from articles where event_id = ${eventId} and importance = 'CRITICAL' order by fetched_at desc limit 1`;
  const worthy = alertWorthy(e.importance, e.source_names ?? [], e.has_official);
  // Same storyline as an event we already alerted on in the last 2 h? Then don't open a second alert thread for it.
  let dupStoryline = false;
  if (!done.some((d) => d.stage === "initial" && d.status === "sent")) {
    const recent = await sql`select distinct e2.headline from events e2 join notifications n on n.event_id = e2.id
      where n.stage = 'initial' and n.status = 'sent' and n.created_at > now() - interval '2 hours' and e2.id <> ${eventId} and e2.is_test = ${e.is_test}`;
    dupStoryline = recent.some((r) => similarity(e.headline, r.headline) >= DUP_STORYLINE_SIM);
  }
  const lastUpdateByDevice = new Map<number, number>();
  for (const r of await sql`select subscription_id, max(created_at) at from notifications where status = 'sent' and stage like 'update:%' and created_at > now() - interval '1 hour' group by 1`)
    lastUpdateByDevice.set(Number(r.subscription_id), new Date(r.at).getTime());
  const pe: PushEvent = {
    id: e.id, headline: e.headline, summary: e.summary, importance: e.importance, verification: e.verification, location: e.location,
    confirmed_facts: e.confirmed_facts, claims: e.claims, sources: publisherNames(e.source_names),
  };
  let sent = 0, failed = 0;
  const now = new Date();

  for (const sub of subs) {
    if (!wantsEvent(sub.prefs, e.importance, e.category, now)) continue;
    if (sub.prefs.level !== "all" && !worthy) continue; // not credible enough yet: re-checked when more sources join
    const mine = done.filter((d) => d.subscription_id === sub.id);
    const isDone = (st: Stage) => mine.some((d) => d.stage === st && (d.status !== "failed" || d.attempts >= 3 || now.getTime() - new Date(d.created_at).getTime() < 120_000));
    const initialSent = mine.some((d) => d.stage === "initial" && d.status === "sent");
    const pending = stagesNow.filter((s) => !isDone(s));
    const lastSent = Math.max(0, ...mine.filter((d) => d.status === "sent").map((d) => new Date(d.created_at).getTime()));
    let stage: Stage, covered: Stage[];
    if (pending.length) {
      if (!initialSent && dupStoryline) continue;
      // If the first message is going out now, it already reflects the latest verification: mark later stages as skipped.
      stage = initialSent ? pending[pending.length - 1] : "initial";
      covered = initialSent ? [stage] : pending;
    } else if (crit && initialSent && new Date(crit.fetched_at).getTime() > lastSent && now.getTime() - lastSent >= UPDATE_GAP_EVENT_MS && now.getTime() - (lastUpdateByDevice.get(sub.id) ?? 0) >= UPDATE_GAP_DEVICE_MS
      && (opts.ignoreAge || e.is_test || now.getTime() - new Date(crit.published_at).getTime() <= ALERT_MAX_AGE_MS) && !isDone(`update:${crit.id}`)) {
      // A new, recent CRITICAL report arrived after our last alert: one update per event per hour and per device per 20 min; if throttled it is retried on the next pass.
      stage = `update:${crit.id}`;
      covered = [stage];
    } else continue;

    const r = await send(sub, buildPush(pe, stage, initialSent, crit && { title: crit.title, source: publisherName(crit.publisher) }));
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
