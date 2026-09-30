import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import Boot from "@/components/Boot";

export const metadata: Metadata = {
  title: "Saudi News Monitor",
  description: "Live Saudi Arabia news monitoring with verified event clustering and push alerts.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icons/192", apple: "/icons/180" },
  appleWebApp: { capable: true, title: "Saudi News", statusBarStyle: "default" },
};
export const viewport: Viewport = { themeColor: "#0b6b4f", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <div className="wrap">
            <Link href="/" className="brand"><i /> <span>Saudi News Monitor</span></Link>
            <nav className="main">
              <Link href="/">News</Link>
              <Link href="/settings">Alerts</Link>
              <Link href="/status">Status</Link>
              {process.env.ENABLE_TEST_MODE === "true" && <Link href="/test">Test</Link>}
            </nav>
          </div>
        </header>
        <main className="wrap">{children}</main>
        <Boot />
      </body>
    </html>
  );
}
