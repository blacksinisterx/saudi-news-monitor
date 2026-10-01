// Provider abstraction: any OpenAI-compatible chat endpoint (Groq / Gemini / OpenAI / Ollama / LM Studio).
// Swap providers by changing AI_BASE_URL / AI_API_KEY / AI_MODEL — no code change.
import type { Item } from "./pipeline";

export type AiSummary = {
  headline: string; summary: string; what_happened: string;
  confirmed_facts: string[]; claims: string[]; unknowns: string[];
  category?: string; location?: string; importance?: string;
};

// Fallback chain: providers are tried in AI_PROVIDER_ORDER (default gemini,groq,grok,custom). Providers without a key are skipped.
// If every provider fails the caller falls back to the rule-based summary. All three speak the OpenAI chat format.
type Provider = { name: string; base: string; key: string; model: string };

function providers(): Provider[] {
  const e = process.env;
  const all: Record<string, Provider | null> = {
    gemini: e.GEMINI_API_KEY ? { name: "gemini", base: "https://generativelanguage.googleapis.com/v1beta/openai", key: e.GEMINI_API_KEY, model: e.GEMINI_MODEL || "gemini-3.5-flash-lite" } : null,
    groq: e.GROQ_API_KEY ? { name: "groq", base: "https://api.groq.com/openai/v1", key: e.GROQ_API_KEY, model: e.GROQ_MODEL || "openai/gpt-oss-120b" } : null, // groq.com (gsk_… keys)
    grok: e.GROK_API_KEY ? { name: "grok", base: "https://api.x.ai/v1", key: e.GROK_API_KEY, model: e.GROK_MODEL || "grok-3-mini" } : null,
    custom: e.AI_BASE_URL && e.AI_MODEL ? { name: "custom", base: e.AI_BASE_URL.replace(/\/$/, ""), key: e.AI_API_KEY ?? "none", model: e.AI_MODEL } : null,
  };
  return (e.AI_PROVIDER_ORDER || "gemini,groq,grok,custom").split(",").map((n) => all[n.trim()]).filter((p): p is Provider => Boolean(p));
}

export const aiProviderNames = () => providers().map((p) => `${p.name}:${p.model}`);
export const aiEnabled = () => providers().length > 0;

// ponytail: per-instance memory; a provider that just failed is skipped for a while so we don't burn 8 s per event on it.
const coolUntil = new Map<string, number>();

class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

async function chat(p: Provider, system: string, user: string): Promise<string> {
  const res = await fetch(`${p.base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.key}` },
    body: JSON.stringify({
      model: p.model, temperature: 0.1, response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status}: ${(await res.text()).slice(0, 100)}`);
  return (await res.json()).choices?.[0]?.message?.content ?? "";
}

const SYSTEM = `You summarise news for a Saudi Arabia monitor. Reply with ONE JSON object only.
Hard rules:
- Use ONLY the numbered items provided. Never add facts, numbers, names or causes that are not in them.
- Attribute every statement to a named source ("Reuters reported ...", "SPA said ...").
- "confirmed_facts": only statements made by items with role "official". If none are official, return [].
- "claims": what non-official sources report or claim, each attributed.
- "unknowns": what is not established (e.g. no official confirmation, casualty numbers, cause).
- If items contradict each other, say so in "unknowns" as "Reports currently conflict."
- English, neutral tone, no speculation.
JSON keys: headline (<=100 chars), summary (<=220 chars), what_happened (<=400 chars), confirmed_facts[], claims[], unknowns[],
category (security|politics|economy|energy|regional|general), location, importance (CRITICAL|HIGH|NORMAL|LOW).`;

export class AllProvidersFailed extends Error {}

/** Returns the summary plus which provider produced it and which ones failed on the way. Throws AllProvidersFailed if none worked. */
export async function aiSummarize(items: Item[]): Promise<{ summary: AiSummary; provider: string; failures: string[] }> {
  const list = items
    .slice(0, 8)
    .map((i, n) => `${n + 1}. source="${i.source}" role="${i.role}" published=${i.publishedAt.toISOString()}\n   title: ${i.title}${i.snippet ? `\n   snippet: ${i.snippet}` : ""}`)
    .join("\n");
  const hasOfficial = items.some((i) => i.role === "official");
  const failures: string[] = [];

  for (const p of providers()) {
    if ((coolUntil.get(p.name) ?? 0) > Date.now()) { failures.push(`${p.name}: cooling down`); continue; }
    try {
      const m = /\{[\s\S]*\}/.exec(await chat(p, SYSTEM, list));
      if (!m) throw new Error("no JSON in reply");
      const j = JSON.parse(m[0]);
      if (typeof j.headline !== "string" || typeof j.summary !== "string") throw new Error("JSON missing fields");
      const arr = (v: unknown) => (Array.isArray(v) ? v.map(String).slice(0, 6) : []);
      return {
        provider: `${p.name}:${p.model}`, failures,
        summary: {
          headline: j.headline.slice(0, 160), summary: j.summary.slice(0, 300), what_happened: String(j.what_happened ?? "").slice(0, 600),
          confirmed_facts: hasOfficial ? arr(j.confirmed_facts) : [], // enforced in code: no official source => nothing is "confirmed"
          claims: arr(j.claims), unknowns: arr(j.unknowns),
          category: j.category, location: typeof j.location === "string" ? j.location.slice(0, 60) : undefined, importance: j.importance,
        },
      };
    } catch (e) {
      const st = e instanceof HttpError ? e.status : 0;
      coolUntil.set(p.name, Date.now() + (st === 429 ? 120_000 : st === 401 || st === 403 ? 1_800_000 : 30_000));
      failures.push(`${p.name}: ${(e as Error).message}`.slice(0, 160));
    }
  }
  throw new AllProvidersFailed(failures.join(" | ") || "no AI provider configured");
}
