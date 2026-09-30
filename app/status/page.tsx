import { sql } from "@/lib/db";
import Time from "@/components/Time";
import Refresher from "@/components/Refresher";
import { aiProviderNames } from "@/lib/ai";
import { pushConfigured } from "@/lib/push";

export const dynamic = "force-dynamic";

export default async function Status() {
  const [c] = await sql`select
    (select count(*) from articles where fetched_at > now() - interval '24 hours') as art24,
    (select count(*) from articles) as art_total,
    (select count(*) from events where not is_test and first_seen_at > now() - interval '24 hours') as ev24,
    (select count(*) from events where not is_test) as ev_total,
    (select count(*) from push_subscriptions) as subs,
    (select count(*) from notifications where status = 'sent' and created_at > now() - interval '24 hours') as sent24,
    (select count(*) from notifications where status = 'failed' and created_at > now() - interval '24 hours') as failed24`;
  const [lastN] = await sql`select n.created_at, e.headline, e.id from notifications n join events e on e.id = n.event_id where n.status = 'sent' order by n.created_at desc limit 1`;
  const sources = await sql`select id, name, type, role, enabled, last_attempt_at, last_success_at, consecutive_failures, last_error, articles_total, interval_sec from sources where not is_test order by enabled desc, id`;
  const usage = await sql`select case when ai_provider = 'rules' then 'rules' else ai_provider end as p, count(*)::int as n from events where last_seen_at > now() - interval '24 hours' group by 1 order by 2 desc`;
  const logs = await sql`select ts, level, stage, message from processing_logs where level <> 'info' order by ts desc limit 15`;

  const active = sources.filter((s) => s.enabled);
  const ok = active.filter((s) => s.consecutive_failures === 0 && s.last_success_at);
  const newest = active.reduce<number>((m, s) => Math.max(m, s.last_success_at ? new Date(s.last_success_at).getTime() : 0), 0);
  const ageMin = newest ? (Date.now() - newest) / 60000 : Infinity;
  const health = ageMin > 10 ? ["DOWN", "bad", "No source has been fetched successfully in 10+ minutes — the scheduler is probably not running."] : ok.length < active.length * 0.6 ? ["DEGRADED", "", "Several sources are failing (others keep working)."] : ["HEALTHY", "ok", "Monitoring is running."];

  const stat = (n: unknown, label: string) => <div className="stat"><b>{String(n)}</b><span>{label}</span></div>;
  return (
    <>
      <Refresher />
      <h1>System status</h1>
      <div className={`notice ${health[1]}`}><b>{health[0]}</b> — {health[2]}</div>
      <div className="grid">
        {stat(`${ok.length}/${active.length}`, "sources healthy")}
        {stat(c.art24, "articles processed (24 h)")}
        {stat(c.art_total, "articles total")}
        {stat(c.ev24, "events created (24 h)")}
        {stat(c.ev_total, "events total")}
        {stat(c.subs, "push subscriptions")}
        {stat(`${c.sent24} / ${c.failed24}`, "pushes sent / failed (24 h)")}
      </div>
      <p className="meta" style={{ marginTop: 12 }}>
        Last notification: {lastN ? <><Time iso={new Date(lastN.created_at).toISOString()} rel /> — <a href={`/events/${lastN.id}`}>{lastN.headline}</a></> : "none yet"} ·
        AI chain: {aiProviderNames().length ? `${aiProviderNames().join(" → ")} → rules` : "rules only (no API keys)"} · used in last 24 h: {usage.map((u) => `${u.p} ×${u.n}`).join(", ") || "—"} · Push: {pushConfigured() ? "VAPID configured" : "NOT configured"}
      </p>

      <h2>Sources</h2>
      <div className="card tablewrap">
        <table>
          <thead><tr><th>Source</th><th>State</th><th>Last success</th><th>Every</th><th>Articles</th></tr></thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.id}>
                <td>{s.name}<br /><small>{s.type} · {s.role}</small></td>
                <td>
                  {!s.enabled ? <span className="badge b-LOW">disabled</span> : !s.last_attempt_at ? <span className="badge b-NORMAL">pending</span>
                    : s.consecutive_failures === 0 ? <span className="badge v-CONFIRMED">OK</span> : <span className="badge v-CONFLICTING">failing ×{s.consecutive_failures}</span>}
                  {s.last_error && <><br /><small>{s.last_error}</small></>}
                </td>
                <td>{s.last_success_at ? <Time iso={new Date(s.last_success_at).toISOString()} rel /> : "never"}</td>
                <td>{s.interval_sec}s</td>
                <td>{s.articles_total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Recent warnings &amp; errors</h2>
      <div className="card tablewrap">
        {logs.length ? <table><tbody>{logs.map((l, i) => <tr key={i}><td><Time iso={new Date(l.ts).toISOString()} rel /></td><td>{l.level}</td><td>{l.stage}</td><td>{l.message}</td></tr>)}</tbody></table> : <p className="empty">None.</p>}
      </div>
    </>
  );
}
