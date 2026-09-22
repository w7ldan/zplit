import { describe, expect, it } from "vitest";
import { readSource } from "./helpers";

const landing = readSource("src/components/editorial/public-landing.tsx");
const accessFrame = readSource("src/components/editorial/access-frame.tsx");
const siteHeader = readSource("src/components/editorial/site-header.tsx");
const publicAuth = readSource("src/app/styles/70-public-auth-vnext.css");
const legacyPublic = readSource("src/app/styles/10-public.css");

describe("Public UI contract", () => {
  it("keeps public content on the vNext scope and uses the public header separately", () => {
    expect(landing).toContain("public-vnext__hero");
    expect(landing).toContain("public-vnext__flow-step--expense");
    expect(accessFrame).toContain("access-vnext");
    expect(siteHeader).toContain('navigationLabel="Primary navigation"');
    expect(siteHeader).toContain('href="#record"');
    expect(siteHeader).toContain('href="#contexts"');
    expect(siteHeader).toContain('href="#private"');
    expect(siteHeader).toContain('href="/app"');
    expect(publicAuth).toContain(".public-vnext .site-header__access");
    expect(publicAuth).toContain(".access-vnext");
    expect(publicAuth).not.toMatch(/gradient|backdrop-filter|box-shadow:\s*0/i);
    expect(legacyPublic).not.toMatch(/public-home|public-scene|scene-index|journey-|landing-reveal|story-motion/);
  });

  it("keeps the product distinctions truthful in the static examples", () => {
    expect(landing).toContain("Budget stays private");
    expect(landing).toContain("actual Personal and Group cash movement");
    expect(landing).toContain("Peer-to-peer accounting");
    expect(landing).toContain("capability-based access");
    expect(landing).toContain("Conversation can coordinate the group");
    expect(landing).toContain("does not confirm or change the financial state by itself");
    expect(landing).toContain("temporary, read-only link");
    expect(landing).not.toMatch(/fake|seamless|revolutionary|all-in-one|trusted by/i);
  });
});
