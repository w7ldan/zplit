import { describe, expect, it } from "vitest";
import { readCssBundle } from "@/test/read-css-bundle";
import { cssRuleBody, readSource, root } from "./helpers";

const css = readCssBundle(root).css;
const publicSource = readSource("src/app/styles/10-public.css");
const landingSource = readSource("src/components/editorial/landing-scenes.tsx");
const motionSource = readSource("src/components/editorial/landing-reveal.tsx");
const rendererSource = readSource("src/components/editorial/three-landing-canvas.tsx");
const journeySource = readSource("src/components/editorial/journey-showcase.tsx");
const siteHeaderSource = readSource("src/components/editorial/site-header.tsx");

describe("Public UI contract", () => {
  it("keeps the public story dimensional while preserving readable DOM content", () => {
    expect(publicSource).toContain(".public-home { background: var(--paper); }");
    expect(publicSource).toContain(".landing-webgl--ready .landing-hero__visual");
    expect(publicSource).toContain("perspective: 1800px;");
    expect(publicSource).toContain("transform-style: preserve-3d;");
    expect(publicSource).toContain(".landing-webgl canvas");
    expect(publicSource).toContain("@media (prefers-reduced-motion: reduce)");
    expect(publicSource).not.toContain("backdrop-filter");
    expect(motionSource).toContain('import("./three-landing-canvas")');
    expect(rendererSource).toContain("new THREE.WebGLRenderer");
    expect(rendererSource).toContain("new THREE.PerspectiveCamera");
    expect(rendererSource).toContain("new THREE.InstancedMesh");
    expect(landingSource).toContain('data-spatial-scene="model"');
    expect(landingSource).toContain('data-spatial-scene="scopes"');
    expect(landingSource).toContain('data-spatial-scene="history"');
    expect(landingSource).toContain("Focus receipt");
    expect(landingSource).toContain("Search records");
    expect(journeySource).toContain('data-journey-layout="physical-record"');
    expect(journeySource).toContain('role="tablist"');
  });

  it("keeps the access link on the shared primary treatment", () => {
    const detachedHeader = cssRuleBody(publicSource, ".public-home .site-header.header-shell__panel--detached");
    const access = cssRuleBody(publicSource, ".public-home .site-header__access");
    const primary = cssRuleBody(css, ".action-link--primary");

    expect(siteHeaderSource).toContain('actions={<ActionLink href="/app" variant="primary" className="site-header__access">Open Zplit</ActionLink>}');
    expect(publicSource).toContain("grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);");
    expect(detachedHeader).toContain("padding-inline: 1rem;");
    expect(access).toContain("min-height: 2.25rem;");
    expect(primary).toContain("background: var(--ink);");
    expect(primary).toContain("color: var(--paper);");
  });

  it("keeps authenticated selectors out of public styles", () => {
    for (const selector of [".invites-page__columns", ".expense-receipts", ".history-row__link", ".exports-row", ".delete-record-form", ".chat-message", ".record-avatar"]) {
      expect(publicSource).not.toContain(selector);
    }
    expect(publicSource).toContain(".landing-chat-message");
    expect(rendererSource).toContain("frame = requestAnimationFrame(renderFrame)");
    expect(rendererSource).toContain('document.addEventListener("visibilitychange"');
  });
});
