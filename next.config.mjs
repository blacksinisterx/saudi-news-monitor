export default {
  poweredByHeader: false,
  serverExternalPackages: ["postgres", "web-push"],
  async headers() {
    return [
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }, { key: "Service-Worker-Allowed", value: "/" }] },
      { source: "/(.*)", headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "same-origin" },
        { key: "Strict-Transport-Security", value: "max-age=31536000" },
      ] },
    ];
  },
};
