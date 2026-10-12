// Pure, DB-free pipeline logic: relevance, importance, clustering similarity, verification, messages.
export type Importance = "CRITICAL" | "HIGH" | "NORMAL" | "LOW";
export type Verification = "CONFIRMED" | "REPORTED" | "CLAIMED" | "UNCONFIRMED" | "CONFLICTING";
export type Category = "security" | "politics" | "economy" | "energy" | "regional" | "general";
export type Role = "official" | "wire" | "media" | "aggregator";

export const IMPORTANCE_ORDER: Importance[] = ["LOW", "NORMAL", "HIGH", "CRITICAL"];
export const CATEGORIES: Category[] = ["security", "politics", "economy", "energy", "regional", "general"];

const WIRES = new Set(["reuters.com", "apnews.com", "afp.com"]);

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^(www|m|mobile|english|amp)\./, "");
  } catch {
    return url.toLowerCase();
  }
}

const NAMES: Record<string, string> = {
  "reuters.com": "Reuters", "apnews.com": "AP", "afp.com": "AFP", "aljazeera.com": "Al Jazeera", "spa.gov.sa": "SPA",
  "khaleejtimes.com": "Khaleej Times", "timesofisrael.com": "Times of Israel", "jpost.com": "Jerusalem Post", "saudigazette.com.sa": "Saudi Gazette",
  "aawsat.com": "Asharq Al-Awsat", "al-monitor.com": "Al-Monitor", "middleeastmonitor.com": "Middle East Monitor", "aa.com.tr": "Anadolu",
  "oilprice.com": "OilPrice", "arabtimesonline.com": "Arab Times", "dailysabah.com": "Daily Sabah", "haaretz.com": "Haaretz",
  "france24.com": "France 24", "dw.com": "DW", "theguardian.com": "The Guardian", "gulfnews.com": "Gulf News", "newarab.com": "The New Arab", "zawya.com": "Zawya",
  "arabnews.com": "Arab News", "alarabiya.net": "Al Arabiya", "bbc.co.uk": "BBC", "bbc.com": "BBC",
  "middleeasteye.net": "Middle East Eye", "thenationalnews.com": "The National", "gov.sa": "Saudi ministries",
  "test-spa": "SPA (test)", "test-reuters": "Reuters (test)", "test-aljazeera": "Al Jazeera (test)", "test-other": "Other outlet (test)",
};
/** Human name for a publisher host (also the independence key shown to the user). */
export const publisherName = (host: string) => NAMES[host] ?? host;
/** Alert only when an event is credible enough: a trusted/official source, or enough independent outlets. */
export function alertWorthy(imp: Importance, publishers: string[], hasOfficial: boolean): boolean {
  const n = new Set(publishers).size;
  const trusted = hasOfficial || publishers.some((p) => p in NAMES);
  if (imp === "CRITICAL") return n >= 2 || trusted;
  if (imp === "HIGH") return hasOfficial || n >= 3;
  return false;
}
export const ALERT_MAX_AGE_MS = 90 * 60_000; // alerts are for live news: the triggering report must be < 90 min old
export const UPDATE_GAP_EVENT_MS = 10 * 60_000; // novelty is the real filter; these gaps only stop bursts
export const UPDATE_GAP_DEVICE_MS = 5 * 60_000;
export const NOVELTY_WINDOW_H = 3; // compare against what this device was already alerted about in the last 3 h

/* ---- novelty: an alert must tell the user something the previous alerts did not ---- */
const PLACE_RE = /\b(riyadh|jeddah|jiddah|mecca|makkah|medina|madinah|dammam|dhahran|khobar|jubail|abha|khamis mushait|jazan|jizan|najran|tabuk|neom|yanbu|taif|qatif|abqaiq|ras tanura|sanaa|aden|marib|hodeidah|red sea|hormuz|persian gulf|eastern province|kuwait|bahrain|qatar|dubai|abu dhabi|uae|oman|yemen|iran|iraq|israel|gaza|lebanon|syria)\b/g;
const PLACE_ALIAS: Record<string, string> = { jiddah: "jeddah", makkah: "mecca", madinah: "medina", jizan: "jazan" };
const TARGET_RE = /\b(airport|terminal|air ?base|refiner(?:y|ies)|embass(?:y|ies)|seaport|pipeline|desalination|power (?:plant|station)|stadium|hospital|oil (?:facility|field|site)|aramco|consulate|mosque|school|mall)s?\b/g;
const DEVELOPMENTS: [string, RegExp][] = [
  ["ceasefire", /\b(ceasefire|truce)\b/],
  ["interception", /\bintercept\w*/],
  ["retaliation", /\b(retaliat\w*|strikes? back|launch\w* (?:air ?)?strikes|counter-?attack)\b/],
  ["evacuation", /\bevacuat\w+/],
  ["closure", /\b(airspace|airports?)\b.{0,25}\b(clos\w+|shut\w*|suspend\w*)/],
  ["emergency", /\bstate of emergency\b/],
  ["sanctions", /\bsanctions?\b/],
  ["casualties", /\b(kill\w*|dead|died|dies|casualt\w+|wounded|injur\w+|deaths?)\b/],
];
const NOISE = /\b(condemn\w*|reacts?|reactions?|analysis|opinion|explained|explainer|what we know|live updates?|live blog|timeline|editorial|commentary|photos?|video|watch|why|experts?|analysts?|ambitions|era of|media reports|how is|how will|what next)\b|^day \d+\b|\?/i;
// Not incidents: markets, conferences, airline notices. Dropped unless the headline also reports a hard incident.
const SOFT_NOISE = /\b(ftse|stocks?|shares|markets?|brent|crude|oil prices?|congress|conference|forum|expo|exhibition|festival|schedule|opens in|(?:airlines?|airways|air)\b.{0,40}\b(?:suspend\w*|cancel\w*|extend\w*|resum\w*|divert\w*))\b/i;
const HARD_INCIDENT = /\b(missiles?|drones?|killed|kills?|dead|dies|died|struck|intercept\w*|explosions?|blasts?|casualt\w+|ballistic|airstrikes?)\b/i;

export function facets(text: string): Set<string> {
  const t = text.toLowerCase(), out = new Set<string>();
  for (const m of t.matchAll(PLACE_RE)) out.add("p:" + (PLACE_ALIAS[m[1]] ?? m[1]));
  for (const m of t.matchAll(TARGET_RE)) out.add("t:" + m[1].replace(/\s+/g, ""));
  for (const [name, re] of DEVELOPMENTS) if (re.test(t)) out.add("d:" + name);
  for (const m of t.matchAll(/\b(\d{1,4})\s+(?:people\s+)?(?:were\s+)?(?:killed|dead|dies|died|injured|wounded)|\b(?:kills?|killing|leaves?|left|toll (?:rises? )?(?:to|at))\s+(?:at least\s+)?(\d{1,4})\b/g)) {
    const n = Number(m[1] ?? m[2]);
    out.add("toll:" + (n < 10 ? "1-9" : n < 50 ? "10-49" : n < 200 ? "50-199" : "200+")); // a bigger toll bracket counts as news
  }
  return out;
}

/** True if `candidate` adds a new place, target, major development or casualty bracket compared with what was already alerted. */
export function isNovel(candidate: string, recent: string[]): boolean {
  if (NOISE.test(candidate)) return false; // videos, opinion, condemnations, "why..." pieces never alert
  if (SOFT_NOISE.test(candidate) && !HARD_INCIDENT.test(candidate)) return false; // market / conference / airline notices
  const similar = recent.filter((r) => similarity(candidate, r) >= 0.25);
  if (!similar.length) return true; // a different story from anything alerted lately
  const seen = new Set(similar.flatMap((r) => [...facets(r)]));
  return [...facets(candidate)].some((f) => !seen.has(f));
}

export const publisherNames = (hosts: string[] | null) => [...new Set((hosts ?? []).map(publisherName))];

export function roleForHost(host: string, fallback: Role): Role {
  if (host === "gov.sa" || host.endsWith(".gov.sa")) return "official";
  if (WIRES.has(host)) return "wire";
  return fallback === "aggregator" ? "media" : fallback;
}

/* ---------------- Saudi relevance ---------------- */
const DIRECT =
  /\b(saudi|ksa|riyadh|jeddah|jiddah|mecca|makkah|medina|madinah|dammam|dhahran|khobar|jubail|neom|aramco|abqaiq|ras tanura|yanbu|tabuk|najran|jazan|jizan|qatif|al-?ahsa|eastern province|mohammed bin salman|king salman|hajj|umrah|vision 2030|tadawul|two holy mosques)\b/gi;
const REGION_HOT = /\b(houthi|houthis|yemen|red sea|hormuz|persian gulf|gulf of aden)\b/i;
const REGION_OTHER = /\b(iran|iraq|kuwait|bahrain|qatar|uae|emirates|oman|opec|gcc|gulf states)\b/i;
const INCIDENT =
  /\b(missile|drone|rocket|intercept\w*|attack\w*|strike[sd]?|airstrike|explosion|blast|shot down|closure|halt\w*|suspend\w*|tanker|seiz\w*|hijack\w*|ballistic)\b/i;

export function saudiScore(title: string, snippet: string, saudiNative: boolean): number {
  if (saudiNative) return 10;
  const body = `${title} ${snippet}`;
  let s = 0;
  if ((title.match(DIRECT) ?? []).length) s += 4;
  s += Math.min((snippet.match(DIRECT) ?? []).length, 2);
  if (INCIDENT.test(body)) {
    if (REGION_HOT.test(body)) s += 3;
    else if (REGION_OTHER.test(body)) s += 2;
  }
  return s;
}
export const isSaudi = (score: number) => score >= 3;

/* ---------------- importance / category / location ---------------- */
const CRIT =
  /\b(missiles?|ballistic|drone (attack|strike)s?|drones? (intercepted|shot down)|intercept(ed|ion|ions|s)?|air defen[cs]es?|shot down|explosions?|blasts?|air ?strikes?|terror(ist)? attack|suicide (bomb|attack)|hostages?|state of emergency|emergency (alert|declared|announcement)|airspace (closed|closure|shut)|airports? (closed|shut|suspend\w*|halt\w*)|flights? (suspended|halted|grounded|diverted|cancel\w+)|evacuat\w+)\b/i;
const CRIT_INFRA =
  /(fire|attack|strike|hit|blaze|explosion).{0,40}(refiner|aramco|oil facilit|pipeline|abqaiq|ras tanura|desalination|power plant)|(refiner|aramco|oil facilit|pipeline|abqaiq|ras tanura|desalination|power plant).{0,40}(fire|attack|struck|hit|blaze|explosion)/i;
const CRIT_TARGET =
  /\b(attack\w*|struck|strikes?|hit|hits|targeted|bomb\w*|shell(ed|ing)|raid\w*)\b.{0,60}\b(airports?|terminals?|air ?bases?|embass(y|ies)|seaports?|desalination|power (plant|station)s?|stadium|mosque|hospital)\b|\b(airports?|terminals?|air ?bases?|embass(y|ies)|seaports?|desalination|power (plant|station)s?)\b.{0,60}\b(attack\w*|struck|targeted|bombed|hit by)\b/i;
const DEAL = /\b(deal|contract|sale|sales|agreement|buy|buys|purchase|order|approve[sd]?|exhibition|expo|show|manufactur\w*|locali[sz]\w*|test[- ]?fire|drill|exercise)\b/i;
const MASS_CASUALTY =
  /\b(\d{2,}|dozens|scores|hundreds)\s+(people\s+)?(killed|dead|died|injured|wounded)|death toll|mass casualt/i;
const SOME_CASUALTY = /\b(killed|dead|died|casualt\w+|wounded)\b/i;
const HIGH =
  /\b(security alert|advis\w* (against|no) travel|travel (advisory|warning)|royal decree|cabinet (approves|decides|issues)|sanctions?|summit|treaty|ceasefire|peace (deal|talks|agreement)|normali[sz]ation|opec\+?|production (cut|increase)|output (cut|hike|increase)|oil prices?|brent|credit rating|budget (deficit|surplus)|aramco (profit|earnings|dividend|results)|border (clash|closure|crossing)|(recall|expel|sever|restore|resume)\w* (diplomatic )?(ties|relations|ambassador)|terror(ist)? (attack|plot|cell)s?)\b/i;
const ENERGY_SHOCK = /\b(resum\w*|halt\w*|suspend\w*|shut\w*|cut\w*|hik\w*|boost\w*)\b.{0,30}\b(oil|crude|gas|lng)\b/i;
const LOW =
  /\b(football|soccer|league|tennis|golf|formula ?1|f1|grand prix|boxing|concert|festival|movie|film|celebrity|fashion|lifestyle|recipe|award|olympic|esports|gaming|entertainment|national day celebrat\w*|celebrations?)\b/i;

/** `saudiInText`: the text itself mentions Saudi/regional context. Casualty rules need it, so a foreign
 *  disaster carried by a Saudi-native feed (e.g. SPA condolences) is not treated as a Saudi emergency. */
export function importanceOf(text: string, saudiInText = true): Importance {
  const crit = CRIT.test(text) || CRIT_INFRA.test(text) || CRIT_TARGET.test(text);
  if (saudiInText && MASS_CASUALTY.test(text)) return "CRITICAL";
  if (crit) return DEAL.test(text) ? "HIGH" : "CRITICAL";
  if ((saudiInText && SOME_CASUALTY.test(text)) || HIGH.test(text) || ENERGY_SHOCK.test(text)) return "HIGH";
  if (LOW.test(text)) return "LOW";
  return "NORMAL";
}

export function maxImportance(a: Importance, b: Importance): Importance {
  return IMPORTANCE_ORDER.indexOf(a) >= IMPORTANCE_ORDER.indexOf(b) ? a : b;
}
/** The AI may raise importance by at most one level but never lower it: a missed critical alert costs more than an extra one. */
export function clampImportance(rule: Importance, ai?: string): Importance {
  const r = IMPORTANCE_ORDER.indexOf(rule);
  const a = IMPORTANCE_ORDER.indexOf(String(ai).toUpperCase() as Importance);
  if (a < 0) return rule;
  return IMPORTANCE_ORDER[Math.min(r + 1, Math.max(r, a))];
}

const CAT_RE: Record<Exclude<Category, "general">, RegExp> = {
  security: /\b(missile|drone|attack|intercept\w*|explosion|terror\w*|militant|police|arrest\w*|security|border|shoot\w*|hostage|houthi|military|army|defen[cs]e|troops|air force)\b/gi,
  energy: /\b(oil|opec\+?|aramco|crude|gas|refiner\w*|energy|petrol\w*|lng|solar|renewable|pipeline|brent|barrel)\b/gi,
  economy: /\b(econom\w*|gdp|inflation|budget|stocks?|tadawul|market|investment|pif|bank\w*|trade|deficit|growth|business|company|ipo|financ\w*|credit|rating|billion|million)\b/gi,
  politics: /\b(minister\w*|crown prince|king|royal|cabinet|government|diplomat\w*|talks|summit|treaty|ambassador|election|council|shura|sanctions?|foreign)\b/gi,
  regional: /\b(yemen|iran|iraq|israel|gaza|lebanon|syria|red sea|hormuz|gulf|houthi|qatar|uae|kuwait|bahrain|oman)\b/gi,
};
const CAT_PRIORITY: Category[] = ["security", "energy", "economy", "politics", "regional"];

export function categoryOf(text: string): Category {
  let best: Category = "general";
  let bestN = 0;
  for (const c of CAT_PRIORITY) {
    const n = (text.match(CAT_RE[c as keyof typeof CAT_RE]) ?? []).length;
    if (n > bestN) [best, bestN] = [c, n];
  }
  return best;
}

const PLACES: [RegExp, string][] = [
  [/\b(riyadh)\b/i, "Riyadh"],
  [/\b(jeddah|jiddah)\b/i, "Jeddah"],
  [/\b(mecca|makkah)\b/i, "Mecca"],
  [/\b(medina|madinah)\b/i, "Medina"],
  [/\b(dammam|dhahran|khobar|jubail|qatif|al-?ahsa|eastern province|abqaiq|ras tanura)\b/i, "Eastern Province"],
  [/\b(jazan|jizan|najran)\b/i, "Southern border"],
  [/\b(tabuk|neom)\b/i, "Tabuk / NEOM"],
  [/\b(red sea)\b/i, "Red Sea"],
  [/\b(yemen)\b/i, "Yemen"],
  [/\b(hormuz|persian gulf)\b/i, "Gulf"],
  [/\b(iran)\b/i, "Iran"],
];
export function locationOf(text: string): string {
  const p = PLACES.find(([re]) => re.test(text));
  if (!p) return "Saudi Arabia";
  return ["Red Sea", "Yemen", "Gulf", "Iran"].includes(p[1]) ? `${p[1]} (regional)` : `${p[1]}, Saudi Arabia`;
}

/* ---------------- clustering ---------------- */
const STOP = new Set(
  "a an the of in on at to for from by with as is are was were be been it its this that and or but after over into near amid says say said new report reports reported un us also has have had will would could may more than about up out no not their his her they he she who what when how why".split(" ")
);
const GENERIC = new Set(["saudi", "arabia", "kingdom", "ksa"]);
const SYN: Record<string, string> = {
  interception: "intercept", interceptions: "intercept", intercepts: "intercept", intercepted: "intercept", intercepting: "intercept",
  missiles: "missile", drones: "drone", defenses: "defense", defences: "defense", defence: "defense",
  explosions: "explosion", blasts: "explosion", blast: "explosion", fires: "fire", killed: "kill", dead: "kill",
  attacks: "attack", attacked: "attack", strikes: "strike", struck: "strike", authorities: "authority",
  announces: "announce", announced: "announce", saudis: "saudi", kingdom: "saudi",
};
const EVENT_TYPES = new Set(["missile", "drone", "intercept", "explosion", "fire", "flood", "attack", "strike", "crash", "earthquake", "protest", "arrest", "kill"]);

export function tokens(title: string): Set<string> {
  const out = new Set<string>();
  for (const w of title.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/[\s-]+/)) {
    if (!w || STOP.has(w)) continue;
    out.add(SYN[w] ?? (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
  }
  return out;
}

export function similarity(a: string, b: string): number {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  const shared = [...ta].filter((t) => tb.has(t));
  const sig = shared.filter((t) => !GENERIC.has(t));
  const typesA = [...ta].filter((t) => EVENT_TYPES.has(t)), typesB = [...tb].filter((t) => EVENT_TYPES.has(t));
  if (typesA.length && typesB.length && !typesA.some((t) => tb.has(t))) return 0; // different kind of event
  if (sig.length < 2) return 0;
  const union = ta.size + tb.size - shared.length;
  return 0.5 * (shared.length / union) + 0.5 * (shared.length / Math.min(ta.size, tb.size));
}
export const CLUSTER_THRESHOLD = 0.4;

/** Stops one event from swallowing a whole storyline: no attaching across long gaps or to very old events. */
export function canAttach(ev: { first: Date; last: Date; importance: Importance }, a: { publishedAt: Date; importance: Importance }, sim: number): boolean {
  const t = a.publishedAt.getTime();
  if (t - ev.last.getTime() > 6 * 3600_000) return false; // quiet for 6 h -> this is a new development
  if (t - ev.first.getTime() > 24 * 3600_000) return false; // hard cap on event age
  if (ev.importance === "CRITICAL" && (a.importance === "LOW" || a.importance === "NORMAL") && sim < 0.6) return false; // chaining guard
  return true;
}

/* ---------------- verification (deterministic; the AI never decides this) ---------------- */
const DENIAL = /\b(den(y|ies|ied|ial)|refut\w+|rebut\w*|dismiss(es|ed)? (reports?|claims?)|false reports?|no truth|contradict\w*|disput\w+)\b/i;
const CLAIM = /\b(claim(s|ed)?|alleg(e|es|ed|edly)|purported\w*|took responsibility|says? it (launched|attacked|targeted)|unverified|unconfirmed)\b/i;

export type Evidence = { publisher: string; role: Role; title: string; snippet: string };

export function verificationOf(items: Evidence[]): { status: Verification; independent: number; confidence: "high" | "medium" | "low" } {
  const independent = new Set(items.map((i) => i.publisher)).size;
  const text = (i: Evidence) => `${i.title} ${i.snippet}`;
  const denies = items.filter((i) => DENIAL.test(text(i)));
  const officials = items.filter((i) => i.role === "official");
  let status: Verification;
  if (denies.length && denies.length < items.length && independent >= 2) status = "CONFLICTING";
  else if (officials.length) status = "CONFIRMED";
  else if (items.some((i) => CLAIM.test(text(i)))) status = "CLAIMED";
  else if (independent >= 2 || items.some((i) => i.role === "wire")) status = "REPORTED";
  else status = "UNCONFIRMED";
  const confidence = status === "CONFLICTING" ? "low" : status === "CONFIRMED" || independent >= 3 ? "high" : status === "REPORTED" ? "medium" : "low";
  return { status, independent, confidence };
}

/* ---------------- rule-based summary (used when AI is off/fails). Every line is attributed. ---------------- */
export type Item = Evidence & { source: string; url: string; publishedAt: Date };
const SHORT = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

export function ruleSummary(items: Item[], v: Verification) {
  const sorted = [...items].sort((a, b) => Number(b.role === "official") - Number(a.role === "official") || a.publishedAt.getTime() - b.publishedAt.getTime());
  const lead = sorted[0];
  const firstSentence = lead.snippet.split(/(?<=[.!?])\s/)[0];
  const officials = items.filter((i) => i.role === "official");
  const others = items.filter((i) => i.role !== "official");
  const uniq = (xs: string[]) => [...new Set(xs)].slice(0, 5);
  const unknowns: string[] = [];
  if (!officials.length) unknowns.push("No confirmation from Saudi authorities yet.");
  if (new Set(items.map((i) => i.publisher)).size === 1) unknowns.push("Only one outlet has reported this so far.");
  if (v === "CONFLICTING") unknowns.push("Reports currently conflict.");
  return {
    headline: lead.title,
    summary: SHORT(firstSentence && firstSentence.length > 30 ? firstSentence : lead.title, 240),
    what_happened: `${lead.source} reported: ${lead.title}`,
    confirmed_facts: uniq(officials.map((i) => `${i.source}: ${i.title}`)),
    claims: uniq(others.map((i) => `${i.source}: ${i.title}`)),
    unknowns,
  };
}

/* ---------------- push message ---------------- */
export type Stage = "initial" | "confirmed" | "conflict" | `update:${number}`; // update:<articleId> = a new CRITICAL development in an ongoing event
export type PushEvent = {
  id: number; headline: string; summary: string; importance: Importance; verification: Verification;
  location: string; confirmed_facts: string[]; claims: string[]; sources: string[];
};

export function buildPush(e: PushEvent, stage: Stage, initialSent: boolean, latest?: { title: string; source: string }) {
  const sev = e.importance === "CRITICAL" ? "🔴" : "🟠";
  const label = initialSent ? "UPDATE" : e.importance === "CRITICAL" ? "BREAKING" : "HIGH";
  const lines = [stage.startsWith("update:") && latest ? `New report: ${SHORT(latest.title, 150)} (${latest.source})` : SHORT(e.summary || e.headline, 170)];
  if (e.verification === "CONFLICTING") lines.push("Reports currently conflict.");
  else if (e.verification === "CONFIRMED") {
    lines.push(`Confirmed: ${SHORT(e.confirmed_facts[0]?.replace(/^[^:]+:\s*/, "") || "reported by a Saudi official source", 110)}`);
    if (e.claims.length) lines.push("Other reports: additional details remain unverified.");
  } else if (e.verification === "CLAIMED") lines.push("Claim only — not confirmed by Saudi authorities.");
  else lines.push("Not yet confirmed by Saudi authorities.");
  lines.push(`Sources: ${e.sources.slice(0, 4).join(" · ")}`);
  lines.push("Tap to read full story.");
  return {
    title: `${sev} ${label} — ${e.location}`,
    body: lines.join("\n"),
    url: `/events/${e.id}`,
    tag: `event-${e.id}`,
    critical: e.importance === "CRITICAL",
    stage,
  };
}

/* ---------------- subscription preferences ---------------- */
export type Prefs = {
  level: "critical" | "high" | "all";
  categories: string[];
  quiet: { enabled: boolean; start: string; end: string; tz: string; allowCritical?: boolean };
};

export function localHHMM(now: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  } catch {
    return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  }
}

export function inQuietHours(p: Prefs, now: Date): boolean {
  const q = p.quiet;
  if (!q?.enabled) return false;
  const t = localHHMM(now, q.tz);
  return q.start <= q.end ? t >= q.start && t < q.end : t >= q.start || t < q.end; // wraps midnight
}

export function wantsEvent(p: Prefs, imp: Importance, category: string, now: Date): boolean {
  const okLevel = p.level === "all" || (p.level === "high" && (imp === "CRITICAL" || imp === "HIGH")) || (p.level === "critical" && imp === "CRITICAL");
  if (!okLevel) return false;
  if (imp !== "CRITICAL" && p.categories?.length && !p.categories.includes(category)) return false;
  if (inQuietHours(p, now) && !(imp === "CRITICAL" && p.quiet.allowCritical !== false)) return false;
  return true;
}
