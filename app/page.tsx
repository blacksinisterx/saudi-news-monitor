import Link from "next/link";
import { getEvents } from "@/lib/queries";
import StoryCard from "@/components/StoryCard";
import Refresher from "@/components/Refresher";

export const dynamic = "force-dynamic";

const TABS: [string, string][] = [
  ["overview", "Overview"], ["breaking", "Breaking / Critical"], ["high", "High importance"], ["latest", "Latest Saudi news"],
  ["security", "Security"], ["politics", "Politics"], ["economy", "Economy"], ["energy", "Energy"], ["regional", "Regional"], ["all", "All news"],
];

type SP = { s?: string; q?: string; imp?: string; ver?: string; hrs?: string };

export default async function Home({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const s = TABS.some(([k]) => k === sp.s) ? sp.s! : "overview";
  const hours = [6, 24, 48, 168, 720].includes(Number(sp.hrs)) ? Number(sp.hrs) : s === "all" ? 168 : 48;
  const common = { q: sp.q, verification: sp.ver, importance: sp.imp, hours };
  const filtered = Boolean(sp.q || sp.imp || sp.ver || sp.hrs);

  const list = (title: string, rows: Awaited<ReturnType<typeof getEvents>>, emptyMsg: string) => (
    <section key={title}>
      <h2>{title}</h2>
      {rows.length ? rows.map((e) => <StoryCard key={e.id} e={e} />) : <p className="empty">{emptyMsg}</p>}
    </section>
  );

  let body: React.ReactNode;
  if (s === "overview" && !filtered) {
    const [crit, high, latest] = await Promise.all([
      getEvents({ importance: "CRITICAL", hours: 48, limit: 10 }),
      getEvents({ importance: "HIGH", hours: 48, limit: 10 }),
      getEvents({ hours: 48, limit: 20 }),
    ]);
    body = <>{list("Breaking / Critical", crit, "No critical events in the last 48 hours.")}{list("High importance", high, "Nothing high-importance in the last 48 hours.")}{list("Latest Saudi news", latest, "No Saudi news yet — is the scheduler running? See Status.")}</>;
  } else {
    const byTab: Record<string, object> = {
      breaking: { importance: "CRITICAL" }, high: { importance: "HIGH" },
      security: { category: "security" }, politics: { category: "politics" }, economy: { category: "economy" }, energy: { category: "energy" }, regional: { category: "regional" },
    };
    const rows = await getEvents({ ...common, ...(byTab[s] ?? {}), ...(s === "all" ? { limit: 200 } : { limit: 100 }) });
    body = list(TABS.find(([k]) => k === s)![1], rows, "Nothing matches.");
  }

  return (
    <>
      <Refresher />
      <nav className="tabs" aria-label="Sections">
        {TABS.map(([k, label]) => <Link key={k} href={`/?s=${k}`} className={k === s ? "on" : ""}>{label}</Link>)}
      </nav>
      <form className="filters" method="get">
        <input type="hidden" name="s" value={s} />
        <input type="search" name="q" placeholder="Search headlines, places…" defaultValue={sp.q} aria-label="Search" />
        <select name="imp" defaultValue={sp.imp ?? ""} aria-label="Importance">
          <option value="">Any importance</option>{["CRITICAL", "HIGH", "NORMAL", "LOW"].map((x) => <option key={x}>{x}</option>)}
        </select>
        <select name="ver" defaultValue={sp.ver ?? ""} aria-label="Verification">
          <option value="">Any verification</option>{["CONFIRMED", "REPORTED", "CLAIMED", "UNCONFIRMED", "CONFLICTING"].map((x) => <option key={x}>{x}</option>)}
        </select>
        <select name="hrs" defaultValue={sp.hrs ?? ""} aria-label="Time range">
          <option value="">Default range</option><option value="6">6 h</option><option value="24">24 h</option><option value="48">48 h</option><option value="168">7 days</option><option value="720">30 days</option>
        </select>
        <button className="primary" type="submit">Filter</button>
        {(filtered) && <Link className="btn" href={`/?s=${s}`}>Clear</Link>}
      </form>
      {body}
    </>
  );
}
