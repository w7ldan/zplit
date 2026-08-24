import { readFileSync } from "node:fs";
import path from "node:path";

export const root = process.cwd();

export function readSource(relativePath: string) {
  return readFileSync(path.resolve(root, relativePath), "utf8");
}

export function cssBraceDepth(source: string) {
  let depth = 0;
  let quote = "";
  let comment = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (comment) {
      if (character === "*" && next === "/") {
        comment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "/" && next === "*") {
      comment = true;
      index += 1;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth < 0) return depth;
    }
  }

  return depth;
}

export function cssRuleBody(source: string, selector: string) {
  const expected = selector.trim().replace(/\s+/g, " ");
  for (const match of source.matchAll(/(?:^|\n)([^{}]+)\{([^{}]*)\}/g)) {
    if (match[1].trim().replace(/\s+/g, " ") === expected) return match[2];
  }
  return "";
}

export function cssAtRuleBodies(source: string, atRule: string) {
  const bodies: string[] = [];
  let searchFrom = 0;
  while (true) {
    const start = source.indexOf(`${atRule} {`, searchFrom);
    if (start < 0) return bodies;
    const open = source.indexOf("{", start);
    let depth = 1;
    for (let index = open + 1; index < source.length; index += 1) {
      if (source[index] === "{") depth += 1;
      else if (source[index] === "}" && --depth === 0) {
        bodies.push(source.slice(open + 1, index));
        searchFrom = index + 1;
        break;
      }
    }
  }
}
