import { sql } from "./db";
import type { Role } from "./pipeline";

export type SourceDef = {
  id: string; name: string; type: "rss" | "gdelt"; url: string; role: Role;
  publisher: string;      // independence key; aggregators resolve the real publisher per item
  saudi_native?: boolean; // every item is Saudi-relevant
  interval_sec?: number;
  enabled?: boolean;
  note: string;           // verification result, shown in README
};

const gn = (q: string) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;

/**
 * Sources are DATA: edit this list (or the `sources` table / enabled flag) — nothing else is hardcoded.
 * Verified 2026-09-29 from a Pakistan residential network. Where a publisher has no public feed we use
 * Google News' site-restricted RSS (a public feed that links to the original article).
 */
export const SOURCES: SourceDef[] = [
  { id: "arabnews-saudi", name: "Arab News (Saudi)", type: "rss", url: "https://www.arabnews.com/taxonomy/term/1/feed", role: "media", publisher: "arabnews.com", saudi_native: true, note: "Direct RSS; sometimes served a Cloudflare bot challenge instead of XML (detected, never bypassed) — see arabnews-gn fallback" },
  { id: "arabnews-all", name: "Arab News", type: "rss", url: "https://www.arabnews.com/rss.xml", role: "media", publisher: "arabnews.com", note: "Direct RSS, OK" },
  { id: "arabnews-gn", name: "Arab News (via Google News)", type: "rss", url: gn("site:arabnews.com Saudi when:1d"), role: "media", publisher: "arabnews.com", note: "Fallback when the direct feed is challenged" },
  { id: "aljazeera", name: "Al Jazeera", type: "rss", url: "https://www.aljazeera.com/xml/rss/all.xml", role: "media", publisher: "aljazeera.com", note: "Direct RSS; connection reset from the tested network (ISP block?) — reachable from most cloud hosts; fallback below" },
  { id: "aljazeera-gn", name: "Al Jazeera (via Google News)", type: "rss", url: gn("site:aljazeera.com (Saudi OR Riyadh OR Houthi OR Yemen OR Iran OR Gulf) when:1d"), role: "media", publisher: "aljazeera.com", note: "Fallback for the direct feed; Google News indexing adds minutes of delay" },
  { id: "reuters-gn", name: "Reuters (via Google News)", type: "rss", url: gn("site:reuters.com (Saudi OR Riyadh OR Aramco OR Houthi OR Yemen OR Iran OR Gulf) when:1d"), role: "wire", publisher: "reuters.com", note: "Reuters discontinued public RSS (404) — Google News site-search feed; links redirect to reuters.com" },
  { id: "spa-gn", name: "Saudi Press Agency (via Google News)", type: "rss", url: gn("site:spa.gov.sa/en when:1d"), role: "official", publisher: "spa.gov.sa", saudi_native: true, note: "SPA has no public RSS (page is HTML); Google News site-search feed of spa.gov.sa/en" },
  { id: "gov-sa-gn", name: "Saudi ministries (gov.sa via Google News)", type: "rss", url: gn("site:gov.sa when:1d"), role: "official", publisher: "gov.sa", saudi_native: true, note: "Aggregated feed of *.gov.sa sites incl. ministries, PIF; mostly duplicates SPA" },
  { id: "alarabiya-gn", name: "Al Arabiya English (via Google News)", type: "rss", url: gn("site:english.alarabiya.net Saudi when:1d"), role: "media", publisher: "alarabiya.net", note: "Al Arabiya's RSS URLs return 404 — Google News site-search feed" },
  { id: "bbc-me", name: "BBC Middle East", type: "rss", url: "https://feeds.bbci.co.uk/news/world/middle_east/rss.xml", role: "media", publisher: "bbc.co.uk", note: "Direct RSS, OK" },
  { id: "mee", name: "Middle East Eye", type: "rss", url: "https://www.middleeasteye.net/rss", role: "media", publisher: "middleeasteye.net", note: "Direct RSS, OK" },
  { id: "thenational", name: "The National", type: "rss", url: "https://www.thenationalnews.com/arc/outboundfeeds/rss/?outputType=xml", role: "media", publisher: "thenationalnews.com", interval_sec: 180, note: "Direct RSS, OK (large, polled less often)" },
  { id: "gn-saudi-live", name: "Google News: Saudi (last hour)", type: "rss", url: gn('"Saudi Arabia" OR Riyadh OR Jeddah OR Aramco when:1h'), role: "aggregator", publisher: "google-news", note: "Cross-publisher discovery; real publisher taken from each item" },
  { id: "gn-saudi-security", name: "Google News: Saudi security (last hour)", type: "rss", url: gn("(Saudi OR Riyadh OR Jeddah OR Houthi) (missile OR drone OR intercept OR explosion OR attack) when:1h"), role: "aggregator", publisher: "google-news", interval_sec: 120, note: "Fast lane for security incidents" },
  { id: "gdelt", name: "GDELT DOC 2.0", type: "gdelt", url: "https://api.gdeltproject.org/api/v2/doc/doc?query=(Saudi%20OR%20Riyadh%20OR%20Jeddah%20OR%20Aramco)%20sourcelang:english&mode=artlist&format=json&maxrecords=50&timespan=1h&sort=datedesc", role: "aggregator", publisher: "gdelt", interval_sec: 300, note: "Free JSON API; ~15 min data latency, limit 1 req / 5 s (429 handled)" },
];

export async function seedSources() {
  for (const s of SOURCES) {
    await sql`
      insert into sources (id, name, type, url, role, publisher, saudi_native, interval_sec, enabled)
      values (${s.id}, ${s.name}, ${s.type}, ${s.url}, ${s.role}, ${s.publisher}, ${s.saudi_native ?? false}, ${s.interval_sec ?? 120}, ${s.enabled ?? true})
      on conflict (id) do update set name = excluded.name, url = excluded.url, role = excluded.role,
        publisher = excluded.publisher, saudi_native = excluded.saudi_native, type = excluded.type`;
    // interval_sec / enabled are intentionally NOT overwritten: tune them in the DB without redeploying.
  }
}
