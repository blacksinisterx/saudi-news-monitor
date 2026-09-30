# Saudi News Monitor

Personal 24/7 Saudi Arabia news monitor: detects new articles, keeps only Saudi-relevant ones, clusters duplicates into one **event**, scores importance, computes a **verification status** from source types, summarises, and pushes an English notification to your phone and laptop. Runs as scheduled serverless jobs — nothing needs your laptop or a server process to stay on.

## Architecture

```
Cloudflare Worker (cron, every 1 min, free)
        │  POST /api/cron/ingest  (Bearer CRON_SECRET)   → returns 202, work continues via after()
        ▼
Next.js on Vercel Hobby ── runs 2 ingest passes ~30 s apart per tick
   1. due sources (per-source interval + exponential backoff on failure), fetched in parallel, 9 s timeout, 1 retry
   2. parse RSS/Atom/GDELT (malformed XML salvaged; HTML bot-challenge pages detected, never bypassed)
   3. Saudi relevance score → only relevant articles stored (metadata + ≤300-char feed snippet, original URL)
   4. dedupe: unique URL; cluster into events (title similarity + event-type/entity agreement + 48 h window)
   5. importance (rules; optional AI may move it ±1 level) · category · location
   6. verification (deterministic — the AI never decides it): CONFIRMED / REPORTED / CLAIMED / UNCONFIRMED / CONFLICTING
   7. summary: AI chain Gemini → Groq (important events only); if all fail or no keys → attributed rule-based extraction. The provider used is stored per event, shown on the story page and /status, and logged
   8. push: per-subscription prefs, one message per (event, device, stage), UPDATE when SPA later confirms
        ▼
Supabase Postgres  ◄── dashboard / detail / status / settings (Next.js, PWA) ◄── you
        │
Web Push (VAPID; Chrome/Edge/Firefox/Android/iOS-PWA push services) ──► phone + laptop
```

Design choices: single language (TypeScript) instead of Python, no Redis (a `locks` row gives single-flight across serverless instances), no embeddings in v1 (see "Upgrade paths"), no FCM SDK (standard Web Push covers Android, iOS PWA, desktop with one code path).

**Verification rules** (`lib/pipeline.ts → verificationOf`): an official Saudi source (`*.gov.sa`, SPA) in the event ⇒ CONFIRMED · a denial word in some but not all items from ≥2 publishers ⇒ CONFLICTING ("Reports currently conflict.") · claim/allegation wording without an official ⇒ CLAIMED · ≥2 independent publishers or a wire ⇒ REPORTED · otherwise UNCONFIRMED. Independence = distinct publisher host (Reuters via two feeds counts once). Push text never says "Confirmed" unless an official source is in the event; AI `confirmed_facts` are dropped in code when there is no official item.

## Sources (verified 2026-09-29 — `lib/sources.ts`, editable, tunable in the `sources` table)

| Source | Method | Status |
|---|---|---|
| Arab News (Saudi + all) | direct RSS | works; the Saudi feed truncates `</rss>` (salvaged); sometimes serves a Cloudflare challenge (detected, not bypassed) → `arabnews-gn` fallback |
| Reuters | Google News `site:reuters.com` RSS | Reuters removed public RSS (404). Links redirect via Google News |
| Saudi Press Agency | Google News `site:spa.gov.sa/en` RSS | SPA has no public RSS (page is HTML). robots.txt allows crawling but no feed exists |
| Saudi ministries (`gov.sa`) | Google News `site:gov.sa` RSS | optional, mostly duplicates SPA |
| Al Jazeera | direct RSS **+** Google News fallback | direct feed reset the connection from my (Pakistan) network; likely works from cloud. Fallback keeps coverage |
| Al Arabiya English | Google News `site:english.alarabiya.net` RSS | its RSS URLs 404 |
| BBC Middle East, Middle East Eye, The National | direct RSS | works |
| Google News "Saudi last hour" + "security last hour" | RSS (30–60 s polling) | fastest discovery lane, publisher taken per item |
| GDELT DOC 2.0 | JSON API, every 5 min | free, ~15 min data latency, limit 1 req / 5 s (429 handled by backoff) |

Arabic-only headlines are skipped in v1 (English notifications requested).

**Latency, honestly:** cron tick every minute, two passes per tick ⇒ detection ≤ ~30–60 s after an item appears in a feed we poll every 30–60 s, then ~1–3 s to notify. Feed lag is outside our control: direct RSS is usually minutes fresh; Google News-derived feeds (Reuters, SPA, Al Arabiya) often lag minutes to tens of minutes; GDELT ≥15 min. Expect 30 s–2 min only for fast direct feeds/the Google News "last hour" lanes; nothing here is guaranteed real-time.

## Folder structure

```
app/                     Next.js App Router
  page.tsx               dashboard (tabs, filters, search)          events/[id]/  story detail
  settings/ status/ test/ login/                                   manifest.ts  icons/[size]/ (generated PNG icons)
  api/cron/ingest        scheduler entry (bearer auth)              api/push/{subscribe,prefs,test}
  api/health (public)    api/login   api/test/inject
components/              StoryCard, PushSettings, TestPanel, Refresher, Time, Boot (SW registration)
lib/
  pipeline.ts            pure logic: relevance, importance, clustering, verification, push text, prefs  (+ tests)
  fetchers.ts            RSS/Atom/GDELT fetch + tolerant parsing                                         (+ tests)
  ingest.ts              orchestration, clustering, event refresh, test-mode injection
  ai.ts                  provider-agnostic (OpenAI-compatible) summariser
  push.ts  sources.ts  db.ts  auth.ts  log.ts  queries.ts
middleware.ts            session auth + rate limiting
db/schema.sql            users, sources, articles, events, event_sources, push_subscriptions, notifications, processing_logs, locks
public/sw.js offline.html  service worker (offline shell + push) / offline page
worker/                  Cloudflare Worker cron (index.js, wrangler.toml)
scripts/                 local-db (PGlite), db-setup, cron-loop, e2e, reset
```

## Local development (Windows/macOS/Linux, Node 20+)

```bash
npm install
cp .env.example .env.local        # then edit: APP_PASSWORD, and generate secrets/keys below
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # → SESSION_SECRET, again → CRON_SECRET
npm run vapid                      # → VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (+ VAPID_SUBJECT=mailto:you@…)

npm run db:local                   # terminal 1: zero-install Postgres (PGlite) on :5433, data in ./.pglite
npm run db:setup                   # once: creates tables + seeds sources
npm run dev                        # terminal 2: http://localhost:3000  (log in with APP_PASSWORD)
npm run cron                       # terminal 3: calls the ingest endpoint every minute, prints stats
```

Notes: PGlite accepts one connection at a time, so stop `dev` (or close the browser tab) before running `db:setup`/`reset`; with Docker you can use a real Postgres instead (`docker run -p 5433:5432 -e POSTGRES_PASSWORD=postgres postgres:16`). Push on `localhost` works in desktop Chrome/Edge (localhost counts as secure); phones need the HTTPS deployment.

**Tests:** `npm test` (10 pure-logic checks: relevance, importance, the Reuters/Al Jazeera/SPA clustering example, verification, prefs, push text, malformed RSS). **End-to-end:** start dev with `NODE_TLS_REJECT_UNAUTHORIZED=0 npm run dev` (only so the mock push service's self-signed cert is accepted), then `npm run e2e` — logs in, subscribes a mock push endpoint, injects the demo scenario and asserts: 3 articles → **one** event, push after the first report, **no** push for duplicate coverage, **UPDATE** push when SPA confirms, event page/dashboard show it, API rejects unauthenticated/`http://` subscriptions. Requires `openssl` on PATH.

**Test mode** (`ENABLE_TEST_MODE=true`, page `/test`): inject the demo scenario or a custom article through the real pipeline (labelled TEST, never merged with real events). Set it to `false` in production once you have verified delivery.

## Deployment (all free tiers)

1. **Supabase**: new project → *SQL Editor* → paste `db/schema.sql` → run. Then run the seed once from your machine with the Supabase URI: set `DATABASE_URL` (Settings → Database → Connection string → **Transaction pooler**, port 6543) in `.env.local` and `npm run db:setup`.
2. **Vercel** (Hobby): push this folder to a GitHub repo → *Import* in Vercel → add env vars from `.env.example` (`DATABASE_URL`, `APP_PASSWORD`, `SESSION_SECRET`, `CRON_SECRET`, `VAPID_*`, optional `AI_*`; set `ENABLE_TEST_MODE=true` for the first verification). Deploy → you get `https://<name>.vercel.app` (HTTPS is automatic). Do **not** rely on Vercel Cron: Hobby only allows daily.
3. **Cloudflare Worker cron**:
   ```bash
   cd worker
   # edit wrangler.toml: APP_URL = "https://<name>.vercel.app"
   npx wrangler login
   npx wrangler secret put CRON_SECRET      # same value as in Vercel
   npx wrangler deploy
   ```
4. Open the site, log in, **Status** should turn HEALTHY within ~2 minutes. `GET /api/health` is a public minimal probe (200 only if a source succeeded in the last 10 min) — point a free UptimeRobot monitor at it if you like.
5. Enable alerts on each device (below), press **Send test notification**, then use **/test** to inject the demo and confirm the two pushes arrive.

Free alternative to Cloudflare for the scheduler: a GitHub Actions workflow with `schedule: cron: "*/5 * * * *"` calling the same endpoint (5-min minimum, best-effort timing) — worse latency, same code.

## Install & enable notifications

- **Android (Chrome):** open the site → ⋮ menu → **Install app** (or *Add to Home screen*) → open it → **Alerts** → *Enable alerts on this device* → Allow. Check that Chrome/site notifications are on in Android settings and battery optimisation isn't restricting Chrome.
- **iPhone (iOS/iPadOS 16.4+):** open the site in **Safari** → Share → **Add to Home Screen** → open the new home-screen icon (push only works from the installed app, not a Safari tab) → **Alerts** → *Enable alerts on this device* → Allow. Set Focus modes to allow the app if you use them.
- **Laptop (Chrome/Edge):** open the site → **Alerts** → *Enable alerts on this device* → Allow. Optionally install (address-bar install icon) so it runs as its own window. Make sure OS notifications are on (Windows *Settings → System → Notifications*; disable Focus Assist/Do Not Disturb if you want criticals to show). Alerts arrive even when the tab/browser window is closed as long as the browser process is running; on a fully shut-down laptop the phone still receives them.

Settings are per device: *Critical only / Critical + High / All*, category filter, quiet hours (Critical can bypass; default yes). Only CRITICAL and HIGH notify by default.

## Free services used and limits

| Service | Use | Free-tier limit that matters |
|---|---|---|
| Vercel Hobby | Next.js hosting + API | personal/non-commercial use only; function max 60 s (we set 60); Hobby cron is daily-only (so unused); ~43k cron invocations/month ≪ limits |
| Supabase Free | Postgres | 500 MB DB (pruning built in: logs 7 d, data 90 d); project pauses after 7 days idle (the 1-min cron prevents it); no SLA |
| Cloudflare Workers Free | 1-min cron | 100k requests/day (we use 1,440); cron triggers are best-effort within a few seconds |
| Web Push (browser vendors) | notifications | free; iOS needs installed PWA, 16.4+ |
| Google News RSS | Reuters/SPA/Al Arabiya/aggregation | unofficial feed, no SLA, may throttle or change; links redirect via Google |
| GDELT | discovery | 1 req/5 s, ~15 min delay |
| AI (optional) | summaries | fallback chain Gemini → Groq → rule-based (`GEMINI_API_KEY`, `GROQ_API_KEY`); free quotas are rate/day-limited and change, check your key's limits |

**What costs money if you scale:** Vercel Pro (commercial use, longer functions, ~$20/mo) · Supabase Pro (~$25/mo, no pausing, daily backups) · Cloudflare Workers paid (~$5/mo, not needed for 1/min) · paid AI beyond free quotas · licensed real-time wire access (Reuters Connect, AP, AFP APIs; the only way to get truly first-hand Reuters/Al Jazeera latency) · Redis/Upstash for a shared rate limiter if multi-user · pgvector/embedding API for semantic clustering at volume · sub-minute polling (needs an always-on worker, i.e. a paid host).

## Security

Secrets only in env vars (none reach the browser; the VAPID *public* key is public by design and passed from the server). Cookie session (HMAC-signed, HttpOnly, SameSite=Lax, Secure in production, 90 d) behind a single `APP_PASSWORD`; middleware protects every page and API except login, PWA assets, `/api/health`, and the cron endpoint (which requires its own bearer secret, compared in constant time). Zod validation on all inputs; push endpoints must be `https://`; login limited to 5 tries/min and API to 120/min per IP (in-memory per instance — a known limit, use Upstash if you need a global limiter); RLS is enabled on every table and the app only uses a server-side Postgres connection, so Supabase's public REST key can read nothing; HSTS + `nosniff` + frame denial headers.

Copyright/robots: only feed metadata, headlines and ≤300-char feed snippets are stored, always with the original URL; no article scraping, no paywall or auth bypass; bot challenges are treated as a failed fetch.

## Known limitations / upgrade paths

- Rule-based importance/relevance is deliberately simple and will misjudge some headlines; tune the regexes in `lib/pipeline.ts` (tests document current behaviour). AI can adjust importance by at most one level.
- Clustering uses token similarity, not embeddings. Upgrade: Supabase `pgvector` + a small embedding model, compare vectors for candidates below the threshold.
- English-only; Arabic headlines are skipped.
- Vercel `after()` work can be cut off at 60 s; the pass logic tolerates this (orphaned articles are re-processed next tick).
- The AI path needs a key to exercise; the rule-based path is what is tested here.
