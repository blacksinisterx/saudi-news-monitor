"use client";
import Link from "next/link";
import { useState } from "react";

type Result = { articleId: number; eventId: number; notified: number };

export default function TestPanel() {
  const [out, setOut] = useState<string>("");
  const [res, setRes] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ kind: "wire", title: "", snippet: "" });

  const run = async (body: unknown) => {
    setBusy(true); setOut("Running…"); setRes([]);
    const r = await fetch("/api/test/inject", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) return setOut(`Error: ${j.error ?? r.status}`);
    setRes(j.results); setOut("Done.");
  };

  return (
    <>
      <div className="card">
        <b>Demo: one event, three sources</b>
        <p>Reuters (wire) → Al Jazeera (media) → SPA (official). Expect ONE event; a push after the first article (not yet confirmed), then an UPDATE push once SPA confirms.</p>
        <button className="primary" disabled={busy} onClick={() => run({ scenario: "demo", reset: true })}>Inject demo scenario</button>
      </div>
      <div className="card">
        <b>Custom article</b>
        <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
          <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            <option value="wire">Reuters (wire)</option><option value="media">Al Jazeera (media)</option><option value="official">SPA (official)</option><option value="other">Other outlet</option>
          </select>
          <input type="text" placeholder="Headline (must be about Saudi Arabia to be relevant)" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          <textarea placeholder="Snippet (optional)" value={f.snippet} onChange={(e) => setF({ ...f, snippet: e.target.value })} />
          <button disabled={busy || f.title.length < 5} onClick={() => run(f)}>Inject article</button>
        </div>
      </div>
      {out && <div className="notice ok">{out}</div>}
      {res.length > 0 && (
        <ul className="plain">{res.map((r, i) => <li key={i}>article {r.articleId} → <Link href={`/events/${r.eventId}`}>event {r.eventId}</Link> · pushes sent: {r.notified}</li>)}</ul>
      )}
    </>
  );
}
