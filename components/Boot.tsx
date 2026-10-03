"use client";
import { useEffect } from "react";
import { playAlarm, unlockAudio } from "@/lib/alarm";

// Registers the service worker (offline shell + push) and plays an alarm when a push arrives while the app is open.
export default function Boot() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
    const onMsg = (e: MessageEvent) => e.data?.type === "alert" && playAlarm(Boolean(e.data.critical));
    navigator.serviceWorker.addEventListener("message", onMsg);
    window.addEventListener("pointerdown", unlockAudio, { once: true });
    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
  }, []);
  return null;
}
