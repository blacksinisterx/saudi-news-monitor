import test from "node:test";
import assert from "node:assert/strict";
import { aiSummarize, AllProvidersFailed } from "./ai";
import type { Item } from "./pipeline";

const items: Item[] = [{ publisher: "reuters.com", role: "wire", title: "Missiles intercepted", snippet: "", source: "Reuters", url: "https://x", publishedAt: new Date() }];
const good = { headline: "Missiles intercepted", summary: "Reuters reported interceptions.", what_happened: "x", confirmed_facts: ["made up fact"], claims: ["Reuters: x"], unknowns: [] };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const ok = { choices: [{ message: { content: JSON.stringify(good) } }] };

test("fallback chain: gemini 429 -> grok answers; provider is reported; AI cannot invent 'confirmed' facts", async () => {
  process.env.GEMINI_API_KEY = "g"; process.env.GROK_API_KEY = "x"; process.env.AI_PROVIDER_ORDER = "gemini,grok";
  globalThis.fetch = (async (url: string) => (String(url).includes("googleapis") ? reply(429, { error: "quota" }) : reply(200, ok))) as typeof fetch;
  const r = await aiSummarize(items);
  assert.match(r.provider, /^grok:/);
  assert.ok(r.failures[0].startsWith("gemini: HTTP 429"));
  assert.deepEqual(r.summary.confirmed_facts, []); // no official source in the event
});

test("all providers failing throws so the caller uses rule-based summaries", async () => {
  globalThis.fetch = (async () => reply(500, { error: "down" })) as typeof fetch;
  await assert.rejects(aiSummarize(items), AllProvidersFailed);
});
