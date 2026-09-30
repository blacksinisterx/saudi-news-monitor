import { get as httpsGet } from "node:https";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import { XMLParser } from "fast-xml-parser";
import { hostOf, roleForHost, type Role } from "./pipeline";

export type Raw = { url: string; title: string; snippet: string; publishedAt: Date; publisher: string; role: Role };
export type SourceRow = {
  id: string; type: "rss" | "gdelt"; url: string; role: Role; publisher: string;
  etag: string | null; last_modified: string | null;
};
export type FetchResult = { items: Raw[]; etag?: string | null; lastModified?: string | null; notModified?: boolean };

const UA = "Mozilla/5.0 (compatible; SaudiNewsMonitor/1.0; personal feed reader)";
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", processEntities: true, htmlEntities: true });

const text = (v: unknown): string => (typeof v === "string" ? v : v && typeof v === "object" ? String((v as Record<string, unknown>)["#text"] ?? "") : v == null ? "" : String(v));
const clean = (s: string, n = 300) => {
  const t = s.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
};
const arabicRatio = (s: string) => (s.match(/[؀-ۿ]/g)?.length ?? 0) / Math.max(s.replace(/\s/g, "").length, 1);

function normUrl(u: string): string {
  try {
    const x = new URL(u.trim());
    x.hash = "";
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ocid|cid$)/i.test(k)) x.searchParams.delete(k);
    return x.toString();
  } catch {
    return "";
  }
}

type Res = { status: number; ok: boolean; etag: string | null; lastModified: string | null; text: () => string };

// node:https instead of fetch(): some publisher CDNs answer undici's default headers with 403 but accept a plain client.
// Identifies itself honestly, follows <=3 redirects, obeys timeouts.
function once(url: string, headers: Record<string, string>, ms: number, hops = 0): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = httpsGet(url, { headers: { "User-Agent": UA, ...headers }, timeout: ms }, (r) => {
      const status = r.statusCode ?? 0;
      if (status >= 300 && status < 400 && r.headers.location && hops < 3) {
        r.resume();
        return resolve(once(new URL(r.headers.location, url).toString(), headers, ms, hops + 1));
      }
      const chunks: Buffer[] = [];
      let size = 0;
      r.on("data", (c: Buffer) => { size += c.length; if (size > 5_000_000) req.destroy(new Error("response too large")); else chunks.push(c); });
      r.on("end", () => resolve({
        status, ok: status >= 200 && status < 300,
        etag: (r.headers.etag as string) ?? null, lastModified: (r.headers["last-modified"] as string) ?? null,
        text: () => {
          let b = Buffer.concat(chunks);
          const enc = r.headers["content-encoding"];
          if (enc === "gzip") b = gunzipSync(b);
          else if (enc === "br") b = brotliDecompressSync(b);
          else if (enc === "deflate") b = inflateSync(b);
          return b.toString("utf8");
        },
      }));
      r.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error(`timeout after ${ms}ms`)));
    req.on("error", reject);
  });
}

async function get(url: string, headers: Record<string, string> = {}, ms = 9000): Promise<Res> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await once(url, headers, ms);
      if (res.status >= 500 || res.status === 429) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (e) {
      lastErr = e;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 600)); // one retry for transient network / 5xx
    }
  }
  const code = (lastErr as { code?: string })?.code;
  throw new Error(`${(lastErr as Error)?.message ?? lastErr}${code ? ` (${code})` : ""}`);
}

export function parseRss(xml: string, src: Pick<SourceRow, "publisher" | "role">): Raw[] {
  if (/^\s*(<!doctype html|<html)/i.test(xml.slice(0, 200))) throw new Error("Got an HTML page instead of a feed (bot challenge or moved feed) — not bypassed");
  let doc;
  try {
    doc = parser.parse(xml);
  } catch (e) {
    // Malformed feeds are common (Arab News truncates its closing </rss>). Salvage the complete <item>s.
    const items = xml.match(/<item[\s>][\s\S]*?<\/item>/g);
    if (!items?.length) throw e; // nothing salvageable -> caller records the failure
    doc = parser.parse(`<rss><channel>${items.join("")}</channel></rss>`);
  }
  const raw = doc?.rss?.channel?.item ?? doc?.feed?.entry ?? doc?.["rdf:RDF"]?.item;
  if (!raw) throw new Error("No items in feed (not RSS/Atom?)");
  const arr = Array.isArray(raw) ? raw : [raw];
  const out: Raw[] = [];
  for (const it of arr) {
    let title = clean(text(it.title), 300);
    const link = typeof it.link === "object" ? (Array.isArray(it.link) ? it.link[0] : it.link)?.["@_href"] : it.link;
    const url = normUrl(text(link) || text(it.guid));
    if (!title || !url || arabicRatio(title) > 0.4) continue; // English-only in v1
    // Google News: "Headline - Publisher", real publisher in <source url=...>
    const srcEl = it.source;
    let publisher = src.publisher;
    if (srcEl && typeof srcEl === "object" && srcEl["@_url"]) {
      publisher = hostOf(srcEl["@_url"]);
      const name = text(srcEl);
      if (name && title.endsWith(` - ${name}`)) title = title.slice(0, -(name.length + 3));
    }
    const d = new Date(text(it.pubDate ?? it.published ?? it.updated ?? it["dc:date"]));
    const now = new Date();
    let snippet = clean(text(it.description ?? it.summary ?? it["content:encoded"] ?? ""));
    if (snippet.toLowerCase().startsWith(title.toLowerCase().slice(0, 40))) snippet = ""; // Google News repeats the title
    out.push({
      url, title, snippet, publisher, role: roleForHost(publisher, src.role),
      publishedAt: isNaN(d.getTime()) || d > now ? now : d,
    });
  }
  return out;
}

async function fetchRss(s: SourceRow): Promise<FetchResult> {
  const h: Record<string, string> = { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" };
  if (s.etag) h["If-None-Match"] = s.etag;
  if (s.last_modified) h["If-Modified-Since"] = s.last_modified;
  const res = await get(s.url, h);
  if (res.status === 304) return { items: [], notModified: true };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { items: parseRss(res.text(), s), etag: res.etag, lastModified: res.lastModified };
}

async function fetchGdelt(s: SourceRow): Promise<FetchResult> {
  const res = await get(s.url, {}, 15000);
  const body = res.text();
  if (!body.trim().startsWith("{")) throw new Error(`GDELT non-JSON response: ${body.slice(0, 80)}`);
  const json = JSON.parse(body) as { articles?: { url: string; title: string; seendate: string; domain: string; language?: string }[] };
  const items: Raw[] = [];
  for (const a of json.articles ?? []) {
    const url = normUrl(a.url);
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(a.seendate ?? "");
    const publisher = hostOf(`https://${a.domain}`);
    if (!url || !a.title) continue;
    items.push({
      url, title: clean(a.title), snippet: "", publisher, role: roleForHost(publisher, s.role),
      publishedAt: m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : new Date(),
    });
  }
  return { items };
}

export const fetchSource = (s: SourceRow): Promise<FetchResult> => (s.type === "gdelt" ? fetchGdelt(s) : fetchRss(s));
