// Local stand-in for the Cloudflare cron: hits the ingest endpoint once a minute.
const url = `${process.env.APP_URL ?? "http://localhost:3000"}/api/cron/ingest?sync=1`;
async function tick() {
  try {
    const r = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` }, signal: AbortSignal.timeout(90_000) });
    console.log(new Date().toISOString(), r.status, JSON.stringify(await r.json()));
  } catch (e) {
    console.error(new Date().toISOString(), "cron error:", (e as Error).message);
  }
}
await tick();
setInterval(tick, 60_000);
export {};
