import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkSourceText, exitCode, formatDiagnostic } from "./check-readability";

const file = path.resolve(process.cwd(), "src/fixture.tsx");
const jsxNodes = (count: number, tag = "span") =>
  Array.from({ length: count }, () => `<${tag} />`).join("");

describe("source readability checker", () => {
  it("accepts readable TSX", () => {
    expect(
      checkSourceText(
        "export function Card() {\n  return <article><h2>Title</h2></article>;\n}",
        file,
      ),
    ).toEqual([]);
  });

  it("errors on an executable line over 400 characters", () => {
    const diagnostics = checkSourceText(
      `const value = ${"value + ".repeat(50)}true;`,
      "src/fixture.ts",
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      line: 1,
      rule: "line-length",
      severity: "error",
    });
  });

  it("keeps a hard line error when JSX warning diagnostics overlap it", () => {
    const diagnostics = checkSourceText(
      `const rows = items.map((item) => <div><span /><strong /><button /><small />{${"value + ".repeat(50)}true}</div>);`,
      file,
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      rule: "line-length",
      severity: "error",
    });
    expect(diagnostics.some(({ rule }) => rule === "jsx-local-density")).toBe(false);
    expect(exitCode(diagnostics)).toBe(1);
  });

  it("warns on an executable line over 240 characters without failing", () => {
    const diagnostics = checkSourceText(
      `const value = ${"value + ".repeat(30)}true;`,
      "src/fixture.ts",
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      rule: "line-length",
      severity: "warning",
    });
    expect(exitCode(diagnostics)).toBe(0);
  });

  it("does not warn on a long cohesive function signature", () => {
    const parameters = Array.from(
      { length: 18 },
      (_, index) => `argument${index}: string`,
    ).join(", ");
    const source = `function handler(${parameters}) { return argument0; }`;
    expect(source.length).toBeGreaterThan(240);
    expect(checkSourceText(source, "src/fixture.ts")).toEqual([]);
  });

  it("exempts SQL and theme bootstrap literals but not neighboring executable source", () => {
    const diagnostics = checkSourceText(
      `const query = sql\`${"column ".repeat(80)}\`;\nconst themeBootstrap = \`${"theme ".repeat(80)}\`;\nconst broken = ${"value + ".repeat(50)}true;`,
      "src/db/schema.ts",
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ line: 3, severity: "error" });
  });

  it("errors on a substantial compressed JSX subtree", () => {
    const diagnostics = checkSourceText(
      `const view = <div>${jsxNodes(20)}</div>;`,
      file,
    );
    expect(diagnostics.filter(({ rule }) => rule === "jsx-subtree")).toHaveLength(1);
    expect(exitCode(diagnostics)).toBe(1);
  });

  it("finds a compressed JSX subtree localized inside a multiline component", () => {
    const diagnostics = checkSourceText(
      `export function Page() {\n  return (\n    <main>\n      {items.map((item) => <div>${jsxNodes(20)}</div>)}\n    </main>\n  );\n}`,
      file,
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      line: 4,
      rule: "jsx-subtree",
      severity: "error",
    });
  });

  it("warns on a smaller complex JSX subtree", () => {
    const diagnostics = checkSourceText(
      `const view = <section>{items.map((item) => <article>${jsxNodes(12, "div")}<button /></article>)}</section>;`,
      file,
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      rule: "jsx-density",
      severity: "warning",
    });
  });

  it("does not warn on a compact icon-like JSX tree", () => {
    const diagnostics = checkSourceText(
      `<svg>${jsxNodes(12, "path")}</svg>`,
      file,
    );
    expect(diagnostics).toEqual([]);
  });

  it("warns on mapped nested JSX compressed into one line", () => {
    const diagnostics = checkSourceText(
      "const rows = items.map((item) => <div><span /><strong /><button /><small /></div>);",
      file,
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      rule: "jsx-local-density",
      severity: "warning",
    });
  });

  it("accepts the multiline equivalent of mapped JSX", () => {
    const diagnostics = checkSourceText(
      "const rows = items.map((item) => (\n  <div>\n    <span />\n    <strong />\n    <button />\n    <small />\n  </div>\n));",
      file,
    );
    expect(diagnostics).toEqual([]);
  });

  it("returns deterministic diagnostics with file, line, rule, and reason", () => {
    const diagnostics = checkSourceText(
      `const value = ${"value + ".repeat(50)}true;`,
      file,
    );
    expect(formatDiagnostic(diagnostics[0]!, process.cwd())).toMatch(
      /^src\/fixture\.tsx:1 readability\/error line-length Executable source line is \d+ characters;/,
    );
  });

  it("sorts severity results deterministically", () => {
    const warning = `const value = ${"value + ".repeat(30)}true;`;
    const error = `const value = ${"value + ".repeat(50)}true;`;
    const diagnostics = checkSourceText(`${warning}\n${error}`, file);
    expect(diagnostics.map(({ line, severity }) => ({ line, severity }))).toEqual([
      { line: 2, severity: "error" },
      { line: 1, severity: "warning" },
    ]);
  });

  it("returns a nonzero exit code only when errors exist", () => {
    const warning = checkSourceText(
      `const value = ${"value + ".repeat(30)}true;`,
      file,
    );
    const error = checkSourceText(
      `const value = ${"value + ".repeat(50)}true;`,
      file,
    );
    expect(exitCode(warning)).toBe(0);
    expect(exitCode(error)).toBe(1);
  });
});
