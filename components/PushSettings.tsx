"use client";
import { useCallback, useEffect, useState } from "react";

type Prefs = { level: "critical" | "high" | "all"; categories: string[]; quiet: { enabled: boolean; start: string; end: string; tz: string; allowCritical: boolean } };
const CATS = ["security", "politics", "economy", "energy", "regional", "general"];
const DEFAULT: Prefs = { level: "high", categories: [], quiet: { enabled: false, start: "23:00", end: "07:00", tz: "Asia/Riyadh", allowCritical: true } };

const b64 = (s: string) => {
  const p = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + p).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};
const post = (url: string, body: unknown, method = "POST") =>
  fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export default function PushSettings({ vapidKey }: { vapidKey: string }) {
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT);
  const [msg, setMsg] = useState<{ t: string; kind?: "ok" | "bad" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [env, setEnv] = useState({ supported: true, iosBrowser: false, permission: "default" as string });

  const load = useCallback(async () => {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone = (navigator as unknown as { standalone?: boolean }).standalone || matchMedia("(display-mode: standalone)").matches;
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    setEnv({ supported, iosBrowser: ios && !standalone, permission: supported ? Notification.permission : "denied" });
    if (!supported) return;
    const reg = await navigator.serviceWorker.register("/sw.js");
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      setEndpoint(sub.endpoint);
      const r = await fetch(`/api/push/prefs?endpoint=${encodeURIComponent(sub.endpoint)}`);
      if (r.ok) setPrefs({ ...DEFAULT, ...(await r.json()).prefs });
      else { // server forgot this subscription (e.g. DB reset) -> re-register silently
        await post("/api/push/subscribe", sub.toJSON());
      }
    } else {
      setPrefs((p) => ({ ...p, quiet: { ...p.quiet, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || p.quiet.tz } }));
    }
  }, []);
  useEffect(() => { load().catch(() => {}); }, [load]);

  const wrap = async (fn: () => Promise<string | void>) => {
    setBusy(true); setMsg(null);
    try { const m = await fn(); if (m) setMsg({ t: m, kind: "ok" }); } catch (e) { setMsg({ t: (e as Error).message, kind: "bad" }); }
    setBusy(false);
  };

  const enable = () => wrap(async () => {
    if (!vapidKey) throw new Error("Server has no VAPID keys configured.");
    const perm = await Notification.requestPermission();
    setEnv((e) => ({ ...e, permission: perm }));
    if (perm !== "granted") throw new Error("Notification permission was not granted. Allow it in your browser/site settings and try again.");
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(vapidKey) }));
    const r = await post("/api/push/subscribe", sub.toJSON());
    if (!r.ok) throw new Error("Server rejected the subscription.");
    setEndpoint(sub.endpoint);
    setPrefs({ ...DEFAULT, ...(await r.json()).prefs, quiet: { ...DEFAULT.quiet, ...prefs.quiet } });
    return "Alerts enabled on this device.";
  });

  const save = () => wrap(async () => {
    const r = await post("/api/push/prefs", { endpoint, prefs });
    if (!r.ok) throw new Error((await r.json()).error ?? "Save failed");
    return "Saved.";
  });
  const test = () => wrap(async () => {
    const r = await post("/api/push/test", { endpoint });
    if (!r.ok) throw new Error((await r.json()).error ?? "Test failed");
    return "Test notification sent — it should appear in a few seconds.";
  });
  const disable = () => wrap(async () => {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) { await post("/api/push/subscribe", { endpoint: sub.endpoint }, "DELETE"); await sub.unsubscribe(); }
    setEndpoint(null);
    return "Alerts disabled on this device.";
  });

  const q = (patch: Partial<Prefs["quiet"]>) => setPrefs({ ...prefs, quiet: { ...prefs.quiet, ...patch } });

  return (
    <div>
      {!env.supported && <div className="notice bad">This browser does not support web push.{env.iosBrowser ? "" : " Try Chrome, Edge or Firefox."}</div>}
      {env.iosBrowser && <div className="notice">iPhone/iPad: push only works after you install the app. Tap Share → <b>Add to Home Screen</b>, open it from the home screen, then come back here.</div>}
      {env.permission === "denied" && env.supported && <div className="notice bad">Notifications are blocked for this site. Re-enable them in your browser or phone settings.</div>}
      {msg && <div className={`notice ${msg.kind ?? ""}`}>{msg.t}</div>}

      {!endpoint ? (
        <button className="primary" disabled={busy || !env.supported} onClick={enable}>Enable alerts on this device</button>
      ) : (
        <>
          <fieldset>
            <legend>What should alert me?</legend>
            {([["critical", "Critical only"], ["high", "Critical + High (recommended)"], ["all", "All Saudi news (can be noisy)"]] as const).map(([v, l]) => (
              <label className="row" key={v}><input type="radio" name="level" checked={prefs.level === v} onChange={() => setPrefs({ ...prefs, level: v })} />{l}</label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Categories (none selected = all; Critical always alerts)</legend>
            {CATS.map((c) => (
              <label className="row" key={c}>
                <input type="checkbox" checked={prefs.categories.includes(c)} onChange={(e) => setPrefs({ ...prefs, categories: e.target.checked ? [...prefs.categories, c] : prefs.categories.filter((x) => x !== c) })} />{c}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Quiet hours</legend>
            <label className="row"><input type="checkbox" checked={prefs.quiet.enabled} onChange={(e) => q({ enabled: e.target.checked })} />Silence alerts during quiet hours</label>
            <label className="row">From <input type="time" value={prefs.quiet.start} onChange={(e) => q({ start: e.target.value })} /> to <input type="time" value={prefs.quiet.end} onChange={(e) => q({ end: e.target.value })} /></label>
            <label className="row">Timezone <input type="text" value={prefs.quiet.tz} onChange={(e) => q({ tz: e.target.value })} /></label>
            <label className="row"><input type="checkbox" checked={prefs.quiet.allowCritical} onChange={(e) => q({ allowCritical: e.target.checked })} />Still alert for CRITICAL during quiet hours</label>
          </fieldset>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="primary" disabled={busy} onClick={save}>Save</button>
            <button disabled={busy} onClick={test}>Send test notification</button>
            <button disabled={busy} onClick={disable}>Disable on this device</button>
          </div>
        </>
      )}
    </div>
  );
}
