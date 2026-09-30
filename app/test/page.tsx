import TestPanel from "@/components/TestPanel";

export const dynamic = "force-dynamic";

export default function TestPage() {
  if (process.env.ENABLE_TEST_MODE !== "true") return <p className="empty">Test mode is disabled (set ENABLE_TEST_MODE=true).</p>;
  return (
    <>
      <h1>Test mode</h1>
      <p style={{ color: "var(--muted)" }}>Injects synthetic articles into the <b>real</b> pipeline (relevance → clustering → importance → summary → verification → push → dashboard). Test events are labelled TEST and never merge with real ones.</p>
      <TestPanel />
    </>
  );
}
