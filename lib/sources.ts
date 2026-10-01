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
  { id: "saudigazette", name: "Saudi Gazette", type: "rss", url: "https://saudigazette.com.sa/rssFeed/74", role: "media", publisher: "saudigazette.com.sa", note: "Direct RSS, OK" },
  { id: "aawsat", name: "Asharq Al-Awsat (English)", type: "rss", url: "https://english.aawsat.com/feed", role: "media", publisher: "aawsat.com", interval_sec: 180, note: "Direct RSS, OK (Saudi-owned, large feed)" },
  { id: "jpost", name: "The Jerusalem Post", type: "rss", url: "https://www.jpost.com/rss/rssfeedsfrontpage.aspx", role: "media", publisher: "jpost.com", note: "Direct RSS, OK" },
  { id: "haaretz", name: "Haaretz", type: "rss", url: "https://www.haaretz.com/srv/haaretz-latest-headlines", role: "media", publisher: "haaretz.com", interval_sec: 180, note: "Direct RSS, OK" },
  { id: "almonitor", name: "Al-Monitor", type: "rss", url: "https://www.al-monitor.com/rss", role: "media", publisher: "al-monitor.com", note: "Direct RSS, OK" },
  { id: "mem", name: "Middle East Monitor", type: "rss", url: "https://www.middleeastmonitor.com/feed/", role: "media", publisher: "middleeastmonitor.com", note: "Direct RSS, OK" },
  { id: "anadolu", name: "Anadolu Agency", type: "rss", url: "https://www.aa.com.tr/en/rss/default?cat=world", role: "media", publisher: "aa.com.tr", note: "Direct RSS, OK" },
  { id: "dailysabah", name: "Daily Sabah", type: "rss", url: "https://www.dailysabah.com/rssFeed/10", role: "media", publisher: "dailysabah.com", note: "Direct RSS, OK" },
  { id: "arabtimes", name: "Arab Times (Kuwait)", type: "rss", url: "https://www.arabtimesonline.com/rssFeed/1/", role: "media", publisher: "arabtimesonline.com", interval_sec: 180, note: "Direct RSS, OK" },
  { id: "oilprice", name: "OilPrice.com", type: "rss", url: "https://oilprice.com/rss/main", role: "media", publisher: "oilprice.com", note: "Direct RSS, OK (energy)" },
  { id: "france24", name: "France 24 (Middle East)", type: "rss", url: "https://www.france24.com/en/middle-east/rss", role: "media", publisher: "france24.com", note: "Direct RSS, OK" },
  { id: "dw", name: "Deutsche Welle", type: "rss", url: "https://rss.dw.com/rdf/rss-en-all", role: "media", publisher: "dw.com", interval_sec: 180, note: "Direct RSS (RDF), OK" },
  { id: "guardian", name: "The Guardian (Middle East)", type: "rss", url: "https://www.theguardian.com/world/middleeast/rss", role: "media", publisher: "theguardian.com", note: "Direct RSS, OK" },
  { id: "khaleejtimes-gn", name: "Khaleej Times (via Google News)", type: "rss", url: gn("site:khaleejtimes.com (Saudi OR Riyadh OR Jeddah OR Houthi OR Iran OR Gulf) when:1d"), role: "media", publisher: "khaleejtimes.com", note: "Khaleej Times feeds return 404 — Google News site-search feed" },
  { id: "timesofisrael-gn", name: "Times of Israel (via Google News)", type: "rss", url: gn("site:timesofisrael.com (Saudi OR Riyadh OR Houthi OR Iran OR Gulf OR Yemen) when:1d"), role: "media", publisher: "timesofisrael.com", note: "Direct feed returns 403 to bots (not bypassed) — Google News site-search feed" },
  { id: "gulfnews-gn", name: "Gulf News (via Google News)", type: "rss", url: gn("site:gulfnews.com (Saudi OR Riyadh OR Houthi OR Iran OR Gulf) when:1d"), role: "media", publisher: "gulfnews.com", note: "Gulf News feed URLs return 404 — Google News site-search feed" },
  { id: "newarab-gn", name: "The New Arab (via Google News)", type: "rss", url: gn("site:newarab.com (Saudi OR Riyadh OR Houthi OR Yemen OR Iran OR Gulf) when:1d"), role: "media", publisher: "newarab.com", note: "Direct feed returns 403 (not bypassed) — Google News site-search feed" },
  { id: "zawya-gn", name: "Zawya (via Google News)", type: "rss", url: gn("site:zawya.com (Saudi OR Aramco OR Riyadh) when:1d"), role: "media", publisher: "zawya.com", note: "No public RSS — Google News site-search feed (business)" },
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
