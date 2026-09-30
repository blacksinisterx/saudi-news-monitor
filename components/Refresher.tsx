"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Re-fetches server data every 30 s while the tab is visible (live dashboard without websockets).
export default function Refresher({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === "visible" && router.refresh(), seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
