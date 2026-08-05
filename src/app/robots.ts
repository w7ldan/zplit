import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/app", "/api", "/login", "/join", "/share", "/healthz", "/offline"],
    },
    host: "https://idr.wildan.lol",
    sitemap: "https://idr.wildan.lol/sitemap.xml",
  };
}
