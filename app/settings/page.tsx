import PushSettings from "@/components/PushSettings";

export const dynamic = "force-dynamic";

export default function Settings() {
  return (
    <>
      <h1>Alert settings</h1>
      <p style={{ color: "var(--muted)" }}>Settings are stored per device: enable alerts on your phone and on your laptop separately.</p>
      <PushSettings vapidKey={process.env.VAPID_PUBLIC_KEY ?? ""} />
    </>
  );
}
