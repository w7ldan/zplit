import { readFileSync } from "node:fs";
import path from "node:path";

export type CssBundle = {
  manifestSource: string;
  importedPaths: string[];
  fragmentSources: string[];
  css: string;
};

export function readCssBundle(root = process.cwd()): CssBundle {
  const projectRoot = path.resolve(root);
  const manifestPath = path.join(projectRoot, "src/app/globals.css");
  const stylesRoot = path.join(projectRoot, "src/app/styles");
  const manifestSource = readFileSync(manifestPath, "utf8");
  const imports = [...manifestSource.matchAll(/@import\b([^;]*);/gi)];

  if (imports.length !== (manifestSource.match(/@import\b/gi) ?? []).length) {
    throw new Error("CSS imports must be complete statements");
  }

  const seen = new Set<string>();
  const importedPaths: string[] = [];
  const fragmentSources: string[] = [];

  for (const match of imports) {
    const specifier = match[1].trim();
    const quoted = specifier.match(/^("|')(.*)\1$/);
    if (!quoted) throw new Error(`CSS import is not a quoted local path: ${specifier}`);

    const importPath = quoted[2];
    if (
      !importPath ||
      path.isAbsolute(importPath) ||
      /^[A-Za-z]:[\\/]/.test(importPath) ||
      importPath.startsWith("\\") ||
      /^(?:\/\/|[A-Za-z][A-Za-z\d+.-]*:|url\()/i.test(importPath) ||
      importPath.split(/[\\/]+/).includes("..")
    ) {
      throw new Error(`CSS import is outside the local styles directory: ${importPath}`);
    }

    const resolvedPath = path.resolve(path.dirname(manifestPath), importPath);
    const relativeToStyles = path.relative(stylesRoot, resolvedPath);
    if (
      !relativeToStyles ||
      relativeToStyles.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeToStyles)
    ) {
      throw new Error(`CSS import is outside src/app/styles: ${importPath}`);
    }
    if (seen.has(resolvedPath)) throw new Error(`Duplicate CSS import: ${importPath}`);

    seen.add(resolvedPath);
    importedPaths.push(path.relative(projectRoot, resolvedPath).split(path.sep).join("/"));
    fragmentSources.push(readFileSync(resolvedPath, "utf8"));
  }

  return { manifestSource, importedPaths, fragmentSources, css: fragmentSources.join("") };
}
