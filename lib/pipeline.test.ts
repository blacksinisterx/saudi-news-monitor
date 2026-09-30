import test from "node:test";
import assert from "node:assert/strict";
import * as P from "./pipeline";

test("relevance", () => {
  assert.ok(P.isSaudi(P.saudiScore("Saudi air defenses intercept missiles", "", false)));
  assert.ok(!P.isSaudi(P.saudiScore("Apple unveils new phone", "Sold in Saudi stores", false)));
  assert.ok(P.isSaudi(P.saudiScore("Houthi drone attack hits Red Sea tanker", "Saudi ports on alert", false)));
  assert.ok(P.isSaudi(P.saudiScore("Anything", "", true)));
});

test("importance", () => {
  assert.equal(P.importanceOf("Saudi air defenses intercept missiles near Riyadh"), "CRITICAL");
  assert.equal(P.importanceOf("Saudi Arabia signs missile defense deal with US"), "HIGH");
  assert.equal(P.importanceOf("Fire at Aramco refinery in Ras Tanura"), "CRITICAL");
  assert.equal(P.importanceOf("OPEC+ agrees output cut, Saudi oil minister says"), "HIGH");
  assert.equal(P.importanceOf("Saudi Pro League: Al Hilal win match"), "LOW");
  assert.equal(P.importanceOf("Saudi Arabia opens new university campus"), "NORMAL");
  assert.equal(P.importanceOf("Crash in Jeddah leaves 25 people killed"), "CRITICAL");
  assert.notEqual(P.importanceOf("Flood death toll in Uttar Pradesh rises to 81", false), "CRITICAL"); // foreign disaster via SPA
  assert.equal(P.importanceOf("Sri Lankan facing death sentence in Saudi Arabia"), "NORMAL");
  assert.equal(P.importanceOf("Saudi Arabia resumes oil exports via East-West pipeline"), "HIGH");
  assert.equal(P.importanceOf("IMCTC discusses counter-terrorism cooperation"), "NORMAL");
});

test("clustering: the spec example is ONE event, unrelated is not", () => {
  const r = "Missiles intercepted near Saudi Arabia", aj = "Saudi air defenses intercept missiles", spa = "Saudi authorities announce missile interceptions";
  for (const [a, b] of [[r, aj], [r, spa], [aj, spa]]) assert.ok(P.similarity(a, b) >= P.CLUSTER_THRESHOLD, `${a} ~ ${b}`);
  assert.ok(P.similarity(r, "Saudi Arabia hosts investment forum in Riyadh") < P.CLUSTER_THRESHOLD);
  assert.ok(P.similarity(r, "Fire breaks out at Saudi warehouse in Jeddah") < P.CLUSTER_THRESHOLD);
});

const ev = (publisher: string, role: P.Role, title: string, snippet = "") => ({ publisher, role, title, snippet });
test("verification never invents confirmation", () => {
  assert.equal(P.verificationOf([ev("reuters.com", "wire", "Missiles intercepted")]).status, "REPORTED");
  assert.equal(P.verificationOf([ev("x.com", "media", "Missiles intercepted")]).status, "UNCONFIRMED");
  assert.equal(P.verificationOf([ev("reuters.com", "wire", "a"), ev("aljazeera.com", "media", "b")]).status, "REPORTED");
  assert.equal(P.verificationOf([ev("reuters.com", "wire", "a"), ev("spa.gov.sa", "official", "b")]).status, "CONFIRMED");
  assert.equal(P.verificationOf([ev("x.com", "media", "Group claims it launched drones")]).status, "CLAIMED");
  assert.equal(P.verificationOf([ev("reuters.com", "wire", "Attack reported"), ev("spa.gov.sa", "official", "Ministry denies attack")]).status, "CONFLICTING");
  assert.equal(P.verificationOf([ev("reuters.com", "wire", "a"), ev("reuters.com", "wire", "b")]).independent, 1);
});

test("prefs", () => {
  const p: P.Prefs = { level: "high", categories: ["economy"], quiet: { enabled: true, start: "23:00", end: "07:00", tz: "UTC" } };
  const night = new Date("2026-01-01T02:00:00Z"), day = new Date("2026-01-01T12:00:00Z");
  assert.ok(P.wantsEvent(p, "CRITICAL", "security", night)); // critical bypasses category + quiet
  assert.ok(!P.wantsEvent(p, "HIGH", "economy", night)); // quiet hours
  assert.ok(!P.wantsEvent(p, "HIGH", "security", day)); // category filter
  assert.ok(P.wantsEvent(p, "HIGH", "economy", day));
  assert.ok(!P.wantsEvent({ ...p, level: "critical" }, "HIGH", "economy", day));
});

test("push message matches the spec and never overstates confirmation", () => {
  const base = { id: 7, headline: "h", summary: "Saudi authorities reported that air defenses intercepted multiple missiles near the kingdom.", importance: "CRITICAL" as const, location: "Saudi Arabia", claims: ["Reuters: x"], sources: ["Reuters", "SPA", "Al Jazeera"] };
  const confirmed = P.buildPush({ ...base, verification: "CONFIRMED", confirmed_facts: ["SPA: Saudi authorities reported the interceptions"] }, "initial", false);
  assert.equal(confirmed.title, "🔴 BREAKING — Saudi Arabia");
  assert.match(confirmed.body, /Confirmed: Saudi authorities reported the interceptions/);
  assert.match(confirmed.body, /Sources: Reuters · SPA · Al Jazeera/);
  const unconfirmed = P.buildPush({ ...base, verification: "REPORTED", confirmed_facts: [] }, "initial", false);
  assert.ok(!/Confirmed:/.test(unconfirmed.body) && /Not yet confirmed by Saudi authorities/.test(unconfirmed.body));
  assert.match(P.buildPush({ ...base, verification: "CONFLICTING", confirmed_facts: [] }, "conflict", true).body, /Reports currently conflict\./);
  assert.match(P.buildPush({ ...base, verification: "CONFIRMED", confirmed_facts: [] }, "confirmed", true).title, /UPDATE/);
});
