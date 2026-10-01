import { randomUUID } from "node:crypto";
import { sql } from "./db";
import { log } from "./log";
import { fetchSource, type Raw, type SourceRow } from "./fetchers";
import { aiEnabled, aiSummarize } from "./ai";
import { notifyEvent } from "./push";
import {
  CLUSTER_THRESHOLD, categoryOf, clampImportance, importanceOf, isSaudi, locationOf, maxImportance, ruleSummary,
  saudiScore, similarity, verificationOf, publisherName, CATEGORIES, IMPORTANCE_ORDER, type Importance, type Item, type Role,
} from "./pipeline";

const MAX_PER_PASS = 40; // keeps one pass well inside the 60 s function cap; the rest is picked up by the next pass (orphan recovery)
const MAX_ITEM_AGE_MS = 48 * 3600_000;
const NOTIFY_MAX_AGE_MS = 3 * 3600_000;

type ArticleRow = {
  id: number; title: string; snippet: string; url: string; publisher: string; role: Role; published_at: Date;
  source_id: string; source_name: string; is_test: boolean;
};

/* ---------- single-flight lock (serverless-safe: a row with expiry, no session locks) ---------- */
async function acquire(name: string, seconds: number) {
  const r = await sql`insert into locks (name, locked_until) values (${name}, now() + make_interval(secs => ${seconds}))
    on conflict (name) do update set locked_until = excluded.locked_until where locks.locked_until < now() returning name`;
  return r.length > 0;
}
const release = (name: string) => sql`update locks set locked_until = now() where name = ${name}`;

/* ---------- one ingest pass ---------- */
export async function runIngest() {
  const stats = { sourcesChecked: 0, sourcesFailed: 0, scanned: 0, newArticles: 0, events: 0, notified: 0, skipped: "" };
  if (!(await acquire("ingest", 25))) return { ...stats, skipped: "another pass is running" };
  try {
    const due = await sql<SourceRow[]>`
      select id, type, url, role, publisher, etag, last_modified, saudi_native from sources
      where enabled and not is_test and (last_attempt_at is null or
        last_attempt_at + make_interval(secs => least(interval_sec * power(2, least(consecutive_failures, 4)), 900)) - interval '3 seconds' <= now())`;
    stats.sourcesChecked = due.length;

    const settled = await Promise.allSettled(due.map((s) => fetchSource(s)));
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < due.length; i++) {
      const s = due[i] as SourceRow & { saudi_native: boolean };
      const r = settled[i];
      if (r.status === "rejected") {
        stats.sourcesFailed++;
        const msg = String((r.reason as Error)?.message ?? r.reason).slice(0, 300);
        const [row] = await sql`update sources set last_attempt_at = now(), consecutive_failures = consecutive_failures + 1, last_error = ${msg} where id = ${s.id} returning consecutive_failures`;
        if (row.consecutive_failures === 1 || row.consecutive_failures % 10 === 0) await log("warn", "fetch", `${s.id} failed (${row.consecutive_failures}x): ${msg}`, undefined, s.id);
        continue;
      }
      await sql`update sources set last_attempt_at = now(), last_success_at = now(), consecutive_failures = 0, last_error = null,
                etag = coalesce(${r.value.etag ?? null}, etag), last_modified = coalesce(${r.value.lastModified ?? null}, last_modified) where id = ${s.id}`;
      for (const it of r.value.items) {
        stats.scanned++;
        if (Date.now() - it.publishedAt.getTime() > MAX_ITEM_AGE_MS) continue;
        const score = saudiScore(it.title, it.snippet, s.saudi_native);
        if (!isSaudi(score)) continue; // only Saudi-relevant articles are stored
        rows.push(articleRow(s.id, it, score));
      }
    }

    rows.sort((a, b) => (b.published_at as Date).getTime() - (a.published_at as Date).getTime());
    const fresh = rows.slice(0, MAX_PER_PASS);
    const ids: number[] = [];
    if (fresh.length) {
      const ins = await sql`insert into articles ${sql(fresh as never, "source_id", "url", "title", "snippet", "publisher", "role", "published_at", "saudi_score", "is_saudi")} on conflict (url) do nothing returning id, source_id`;
      for (const r of ins) ids.push(Number(r.id));
      const perSource = new Map<string, number>();
      for (const r of ins) perSource.set(r.source_id, (perSource.get(r.source_id) ?? 0) + 1);
      for (const [sid, n] of perSource) await sql`update sources set articles_total = articles_total + ${n} where id = ${sid}`;
    }
    // crash recovery: articles stored by a pass that died before clustering them
    const orphans = await sql`select id from articles where event_id is null and fetched_at > now() - interval '24 hours' order by published_at desc limit ${MAX_PER_PASS}`;
    for (const o of orphans) if (ids.length < MAX_PER_PASS && !ids.includes(Number(o.id))) ids.push(Number(o.id));
    stats.newArticles = ids.length;
    if (ids.length) {
      const r = await processArticles(ids);
      stats.events = r.events.length;
      stats.notified = r.notified;
    }
    if (Math.random() < 0.02) await prune();
    return stats;
  } catch (e) {
    await log("error", "ingest", `pass crashed: ${(e as Error).message}`);
    throw e;
  } finally {
    await release("ingest");
  }
}

function articleRow(sourceId: string, it: Raw, score: number) {
  return { source_id: sourceId, url: it.url, title: it.title, snippet: it.snippet, publisher: it.publisher, role: it.role, published_at: it.publishedAt, saudi_score: score, is_saudi: true };
}

async function prune() {
  await sql`delete from processing_logs where ts < now() - interval '7 days'`;
  await sql`delete from events where last_seen_at < now() - interval '90 days'`; // cascades to event_sources/notifications
  await sql`delete from articles where fetched_at < now() - interval '90 days'`;
}

/* ---------- cluster + enrich + notify (shared by real ingest and test injection) ---------- */
export async function processArticles(articleIds: number[]) {
  const arts = await sql<ArticleRow[]>`
    select a.id, a.title, a.snippet, a.url, a.publisher, a.role, a.published_at, a.source_id, s.name as source_name, s.is_test
    from articles a join sources s on s.id = a.source_id where a.id in ${sql(articleIds)} order by a.published_at asc`;

  const recent = await sql<{ id: number; is_test: boolean; title: string }[]>`
    select e.id, e.is_test, a.title from events e join event_sources es on es.event_id = e.id join articles a on a.id = es.article_id
    where e.last_seen_at > now() - interval '48 hours'`;
  const pool = new Map<number, { test: boolean; titles: string[] }>();
  for (const r of recent) {
    const p = pool.get(Number(r.id)) ?? { test: r.is_test, titles: [] };
    p.titles.push(r.title);
    pool.set(Number(r.id), p);
  }

  const touched = new Set<number>();
  const created = new Set<number>();
  for (const a of arts) {
    let best = 0, bestId = 0;
    for (const [id, p] of pool) {
      if (p.test !== a.is_test) continue;
      const s = Math.max(...p.titles.map((t) => similarity(a.title, t)));
      if (s > best) [best, bestId] = [s, id];
    }
    let eventId = bestId;
    if (best < CLUSTER_THRESHOLD) {
      const [e] = await sql`insert into events (headline, is_test, first_seen_at, last_seen_at) values (${a.title}, ${a.is_test}, ${a.published_at}, ${a.published_at}) returning id`;
      eventId = Number(e.id);
      pool.set(eventId, { test: a.is_test, titles: [] });
      created.add(eventId);
    }
    pool.get(eventId)!.titles.push(a.title);
    await sql`insert into event_sources (event_id, article_id, source_id) values (${eventId}, ${a.id}, ${a.source_id}) on conflict do nothing`;
    await sql`update articles set event_id = ${eventId} where id = ${a.id}`;
    touched.add(eventId);
  }

  let aiCalls = 0;
  let notified = 0;
  const maxAi = Number(process.env.AI_MAX_CALLS_PER_RUN ?? 4);
  for (const id of touched) {
    try {
      const r = await refreshEvent(id, created.has(id), () => aiCalls < maxAi && (aiCalls++, true));
      if (r.notify) notified += (await notifyEvent(id)).sent;
    } catch (e) {
      await log("error", "event", `event ${id} failed: ${(e as Error).message}`, { id });
    }
  }
  return { events: [...touched], created: [...created], notified };
}

async function refreshEvent(id: number, isNew: boolean, takeAiSlot: () => boolean) {
  const [prev] = await sql`select importance, verification, source_count, ai_provider from events where id = ${id}`;
  const rows = await sql<ArticleRow[]>`
    select a.id, a.title, a.snippet, a.url, a.publisher, a.role, a.published_at, a.source_id, s.name as source_name, s.is_test
    from event_sources es join articles a on a.id = es.article_id join sources s on s.id = es.source_id where es.event_id = ${id}`;
  const items: Item[] = rows.map((r) => ({ publisher: r.publisher, role: r.role, title: r.title, snippet: r.snippet, source: publisherName(r.publisher), url: r.url, publishedAt: new Date(r.published_at) }));

  const v = verificationOf(items);
  const text = items.map((i) => `${i.title}. ${i.snippet}`).join(" ");
  let importance: Importance = items.reduce<Importance>((m, i) => maxImportance(m, importanceOf(`${i.title}. ${i.snippet}`, isSaudi(saudiScore(i.title, i.snippet, false)))), "LOW");
  let category: string = categoryOf(text);
  let location = locationOf(text);
  let fields = ruleSummary(items, v.status);
  let provider = "rules";

  const changed = isNew || prev.source_count !== v.independent || prev.verification !== v.status;
  const wantsAi = aiEnabled() && changed && IMPORTANCE_ORDER.indexOf(importance) >= IMPORTANCE_ORDER.indexOf((process.env.AI_MIN_IMPORTANCE?.toUpperCase() as Importance) ?? "HIGH");
  let keepText = false;
  if (wantsAi && takeAiSlot()) {
    try {
      const r = await aiSummarize(items);
      const ai = r.summary;
      provider = r.provider;
      await log(r.failures.length ? "warn" : "info", "ai", `event ${id} summarised by ${r.provider}${r.failures.length ? ` (fallback after: ${r.failures.join("; ")})` : ""}`, { id });
      fields = {
        headline: ai.headline, summary: ai.summary, what_happened: ai.what_happened || fields.what_happened,
        confirmed_facts: ai.confirmed_facts.length || !items.some((i) => i.role === "official") ? ai.confirmed_facts : fields.confirmed_facts,
        claims: ai.claims, unknowns: ai.unknowns,
      };
      importance = clampImportance(importance, ai.importance);
      if (ai.category && (CATEGORIES as string[]).includes(ai.category)) category = ai.category;
      if (ai.location) location = ai.location;
    } catch (e) {
      await log("warn", "ai", `event ${id}: all AI providers failed, used rule-based summary (${(e as Error).message})`, { id });
      keepText = prev.ai_provider !== "rules"; // don't clobber an earlier good AI summary with a rule one
    }
  } else if (prev.ai_provider !== "rules" && !isNew) keepText = true;
  if (v.status === "CONFLICTING" && !fields.unknowns.includes("Reports currently conflict.")) fields.unknowns.push("Reports currently conflict.");

  const newest = new Date(Math.max(...items.map((i) => i.publishedAt.getTime())));
  const oldest = new Date(Math.min(...items.map((i) => i.publishedAt.getTime())));
  const text2 = keepText
    ? sql`headline = headline`
    : sql`headline = ${fields.headline}, summary = ${fields.summary}, what_happened = ${fields.what_happened},
          confirmed_facts = ${sql.json(fields.confirmed_facts)}, claims = ${sql.json(fields.claims)}, unknowns = ${sql.json(fields.unknowns)}, ai_provider = ${provider}`;
  await sql`update events set ${text2}, category = ${category}, location = ${location}, importance = ${importance},
            verification = ${v.status}, confidence = ${v.confidence}, source_count = ${v.independent},
            first_seen_at = ${oldest}, last_seen_at = ${newest} where id = ${id}`;

  const isTest = rows.some((r) => r.is_test);
  const fresh = Date.now() - newest.getTime() < NOTIFY_MAX_AGE_MS;
  return { notify: isTest || fresh };
}

/* ---------- test mode: same pipeline, synthetic articles ---------- */
const TEST_SOURCES = {
  official: { id: "test-spa", name: "SPA (test)", role: "official", publisher: "test-spa" },
  wire: { id: "test-reuters", name: "Reuters (test)", role: "wire", publisher: "test-reuters" },
  media: { id: "test-aljazeera", name: "Al Jazeera (test)", role: "media", publisher: "test-aljazeera" },
  other: { id: "test-other", name: "Other outlet (test)", role: "media", publisher: "test-other" },
} as const;
export type TestKind = keyof typeof TEST_SOURCES;

export async function injectTest(items: { kind: TestKind; title: string; snippet?: string }[]) {
  for (const s of Object.values(TEST_SOURCES)) {
    await sql`insert into sources (id, name, type, url, role, publisher, saudi_native, enabled, is_test)
              values (${s.id}, ${s.name}, 'rss', 'https://example.test', ${s.role}, ${s.publisher}, false, false, true) on conflict (id) do nothing`;
  }
  const out: { articleId: number; eventId: number; notified: number }[] = [];
  for (const it of items) {
    const s = TEST_SOURCES[it.kind];
    const [a] = await sql`insert into articles (source_id, url, title, snippet, publisher, role, published_at, saudi_score, is_saudi)
      values (${s.id}, ${`https://example.test/${randomUUID()}`}, ${it.title}, ${it.snippet ?? ""}, ${s.publisher}, ${s.role}, now(), 10, true) returning id`;
    const r = await processArticles([Number(a.id)]);
    const [row] = await sql`select event_id from articles where id = ${a.id}`;
    out.push({ articleId: Number(a.id), eventId: Number(row.event_id), notified: r.notified });
  }
  return out;
}

export const DEMO_SCENARIO: { kind: TestKind; title: string; snippet?: string }[] = [
  { kind: "wire", title: "Missiles intercepted near Saudi Arabia, sources say", snippet: "Several missiles were intercepted near the kingdom overnight, two sources told the agency." },
  { kind: "media", title: "Saudi air defenses intercept missiles over Eastern Province" },
  { kind: "official", title: "Saudi authorities announce missile interceptions", snippet: "The Ministry of Defense said air defenses intercepted the missiles with no reported casualties." },
];
