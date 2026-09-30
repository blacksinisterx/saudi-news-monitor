// Cloudflare Worker: the 24/7 scheduler. Fires every minute (free plan) and pokes the app's ingest endpoint.
// The app answers 202 immediately and runs two ingest passes ~30 s apart in the background.
export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      fetch(`${env.APP_URL}/api/cron/ingest`, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
      }).then((r) => {
        if (!r.ok) console.error("ingest trigger failed", r.status);
      })
    );
  },
  async fetch() {
    return new Response("cron worker only", { status: 404 });
  },
};
