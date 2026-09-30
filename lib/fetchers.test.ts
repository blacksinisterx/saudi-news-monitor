import test from "node:test";
import assert from "node:assert/strict";
import { parseRss } from "./fetchers";

const src = { publisher: "example.com", role: "media" as const };
test("malformed RSS (truncated closing tag) is salvaged", () => {
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><item><title>Saudi cabinet approves budget</title><link>https://example.com/a?utm_source=x</link><pubDate>Mon, 01 Jan 2024 10:00:00 GMT</pubDate><description>&lt;p&gt;Details here&lt;/p&gt;</description></item></channel></rss`;
  const [a] = parseRss(xml, src);
  assert.equal(a.title, "Saudi cabinet approves budget");
  assert.equal(a.url, "https://example.com/a"); // tracking params stripped
  assert.equal(a.snippet, "Details here"); // HTML stripped
});
test("HTML challenge page is rejected, not parsed", () => {
  assert.throws(() => parseRss("<!DOCTYPE html><html><title>Just a moment...</title></html>", src), /HTML page/);
});
test("Google News items resolve the real publisher and strip the title suffix", () => {
  const xml = `<rss><channel><item><title>Missiles intercepted - Reuters</title><link>https://news.google.com/rss/articles/abc</link><pubDate>Mon, 01 Jan 2024 10:00:00 GMT</pubDate><source url="https://www.reuters.com">Reuters</source></item></channel></rss>`;
  const [a] = parseRss(xml, { publisher: "google-news", role: "aggregator" });
  assert.equal(a.title, "Missiles intercepted");
  assert.equal(a.publisher, "reuters.com");
  assert.equal(a.role, "wire");
});
test("Arabic-only headlines are skipped (English-only v1)", () => {
  const xml = `<rss><channel><item><title>وزارة الدفاع تعلن اعتراض صواريخ</title><link>https://spa.gov.sa/x</link></item></channel></rss>`;
  assert.equal(parseRss(xml, src).length, 0);
});
