import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Saudi News Monitor",
    short_name: "Saudi News",
    description: "Live Saudi Arabia news monitoring with verification and push alerts",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0f1216",
    theme_color: "#0b6b4f",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/512?maskable=1", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
