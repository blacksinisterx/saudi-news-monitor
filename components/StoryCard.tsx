import Link from "next/link";
import Time from "./Time";

export type EventRow = {
  id: number; headline: string; summary: string; importance: string; verification: string; category: string; location: string;
  source_count: number; last_seen_at: Date; is_test: boolean; source_names: string[] | null;
};

export default function StoryCard({ e }: { e: EventRow }) {
  return (
    <article className={`card ${e.importance === "CRITICAL" ? "crit" : e.importance === "HIGH" ? "high" : ""}`}>
      <div className="meta">
        <span className={`badge b-${e.importance}`}>{e.importance}</span>
        <span className={`badge v-${e.verification}`}>{e.verification}</span>
        <span>{e.category}</span>·<span>{e.location}</span>·<Time iso={new Date(e.last_seen_at).toISOString()} rel />
        {e.is_test && <span className="badge b-test">TEST</span>}
      </div>
      <h3><Link href={`/events/${e.id}`}>{e.headline}</Link></h3>
      {e.summary && e.summary !== e.headline && <p>{e.summary}</p>}
      <div className="meta">
        <span>{(e.source_names ?? []).slice(0, 5).join(" · ")}</span>
        <span>{`· ${e.source_count} independent source${e.source_count === 1 ? "" : "s"}`}</span>
      </div>
    </article>
  );
}
