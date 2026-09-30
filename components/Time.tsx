"use client";

// Renders in the viewer's own locale/timezone (server has no idea what it is).
export default function Time({ iso, rel }: { iso: string; rel?: boolean }) {
  const d = new Date(iso);
  let s = d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  if (rel) {
    const m = Math.round((Date.now() - d.getTime()) / 60000);
    const r = m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : "";
    if (r) s = `${r} · ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }
  return <time dateTime={iso} suppressHydrationWarning title={d.toISOString()}>{s}</time>;
}
