import { sql } from "./db";
import { publisherNames } from "./pipeline";
import type { EventRow } from "@/components/StoryCard";

export type Filter = { importance?: string; category?: string; verification?: string; q?: string; hours?: number; limit?: number };

export async function getEvents(f: Filter = {}): Promise<EventRow[]> {
  const q = f.q?.trim().slice(0, 80);
  const rows = await sql<EventRow[]>`
    select e.id, e.headline, e.summary, e.importance, e.verification, e.category, e.location, e.source_count, e.last_seen_at, e.is_test,
      (select array_agg(distinct a.publisher) from event_sources es join articles a on a.id = es.article_id where es.event_id = e.id) as source_names
    from events e
    where e.last_seen_at > now() - make_interval(hours => ${f.hours ?? 48})
      ${f.importance ? sql`and e.importance = ${f.importance}` : sql``}
      ${f.category ? sql`and e.category = ${f.category}` : sql``}
      ${f.verification ? sql`and e.verification = ${f.verification}` : sql``}
      ${q ? sql`and (e.headline ilike ${"%" + q + "%"} or e.summary ilike ${"%" + q + "%"} or e.location ilike ${"%" + q + "%"})` : sql``}
    order by e.last_seen_at desc limit ${f.limit ?? 50}`;
  return rows.map((r) => ({ ...r, source_names: publisherNames(r.source_names) }));
}
