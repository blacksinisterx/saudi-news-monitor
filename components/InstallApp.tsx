"use client";
import { useEffect, useState } from "react";

type BIP = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

export default function InstallApp() {
  const [evt, setEvt] = useState<BIP | null>(null);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    setInstalled(matchMedia("(display-mode: standalone)").matches || Boolean((navigator as unknown as { standalone?: boolean }).standalone));
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    const h = (e: Event) => { e.preventDefault(); setEvt(e as BIP); };
    window.addEventListener("beforeinstallprompt", h);
    window.addEventListener("appinstalled", () => setInstalled(true));
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);

  if (installed) return <div className="notice ok">App installed on this device.</div>;
  if (evt) return <p><button className="primary" onClick={async () => { await evt.prompt(); setEvt(null); }}>Install app</button></p>;
  if (ios) return <div className="notice">To install on iPhone: open this site in <b>Safari</b> → tap <b>Share</b> (square with arrow) → <b>Add to Home Screen</b> → <b>Add</b>. Then open the app from the home screen.</div>;
  return <div className="notice">To install: Chrome/Edge menu (⋮) → <b>Install app</b> / <b>Add to Home screen</b>. (If you do not see it, reload this page once.)</div>;
}
