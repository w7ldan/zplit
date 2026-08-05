import { describe, expect, it } from "vitest";
import robots from "./robots";
import sitemap from "./sitemap";

describe("crawler metadata", () => {
  it("allows only the public root and denies private route families", () => {
    expect(robots()).toEqual({
      rules: {
        userAgent: "*",
        allow: "/",
        disallow: ["/app", "/api", "/login", "/join", "/share", "/healthz", "/offline"],
      },
      host: "https://idr.wildan.lol",
      sitemap: "https://idr.wildan.lol/sitemap.xml",
    });
  });

  it("publishes only the public root", () => {
    expect(sitemap()).toEqual([{ url: "https://idr.wildan.lol/" }]);
  });
});
