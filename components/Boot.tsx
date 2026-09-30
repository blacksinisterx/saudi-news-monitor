"use client";
import { useEffect } from "react";

// Registers the service worker (offline shell + push) once per page load.
export default function Boot() {
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
