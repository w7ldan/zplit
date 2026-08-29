import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRootName = "src";
const warningLength = 240;
const errorLength = 400;
const warningEvidenceThreshold = 10;

export type ReadabilitySeverity = "error" | "warning";

export type ReadabilityDiagnostic = {
  file: string;
  line: number;
  rule: string;
  severity: ReadabilitySeverity;
  message: string;
};

export type ReadabilityReport = {
  diagnostics: ReadabilityDiagnostic[];
  filesScanned: number;
  runtimeMs: number;
};

type LiteralRange = {
  end: number;
  intentional: boolean;
  start: number;
};

type JsxNode = ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment;

type JsxMetrics = {
  components: number;
  conditional: boolean;
  formAction: boolean;
  graphicsOnly: boolean;
  mapped: boolean;
  maxDepth: number;
  semanticContainers: number;
  total: number;
};

type JsxInfo = {
  context: boolean;
  endLine: number;
  metrics: JsxMetrics;
  node: JsxNode;
  startLine: number;
};

type JsxCandidate = {
  endLine: number;
  line: number;
  message: string;
  node: JsxNode;
  rule: string;
  severity: ReadabilitySeverity;
  startLine: number;
};

type LineEvidence = {
  executableNodes: number;
  hasJsx: boolean;
};

type DiagnosticFinding = {
  diagnostic: ReadabilityDiagnostic;
  end: number;
  start: number;
};

function parseSource(source: string, fileName: string) {
  return ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function isJsxNode(node: ts.Node): node is JsxNode {
  return ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node);
}

function jsxTag(node: JsxNode): ts.JsxTagNameExpression | undefined {
  if (ts.isJsxElement(node)) return node.openingElement.tagName;
  if (ts.isJsxSelfClosingElement(node)) return node.tagName;
  return undefined;
}

function tagText(tag: ts.JsxTagNameExpression | undefined) {
  return tag?.getText().toLowerCase();
}

function isComponentTag(tag: ts.JsxTagNameExpression | undefined) {
  return Boolean(
    tag &&
      (ts.isPropertyAccessExpression(tag) ||
        (ts.isIdentifier(tag) && /^[A-Z]/.test(tag.text))),
  );
}

function isGraphicsTag(name: string | undefined) {
  return Boolean(
    name &&
      [
        "circle",
        "clippath",
        "defs",
        "ellipse",
        "g",
        "line",
        "mask",
        "path",
        "polygon",
        "polyline",
        "rect",
        "svg",
        "title",
        "use",
      ].includes(name),
  );
}

function isSemanticContainer(name: string | undefined) {
  return Boolean(
    name &&
      [
        "article",
        "fieldset",
        "footer",
        "form",
        "header",
        "main",
        "nav",
        "ol",
        "section",
        "table",
        "ul",
      ].includes(name),
  );
}

function hasFormAction(
  node: ts.JsxElement | ts.JsxSelfClosingElement,
  name: string | undefined,
) {
  if (
    name &&
    ["button", "fieldset", "form", "input", "select", "textarea"].includes(name)
  ) {
    return true;
  }
  const attributes = ts.isJsxElement(node)
    ? node.openingElement.attributes
    : node.attributes;
  return attributes.properties.some(
    (property) =>
      ts.isJsxAttribute(property) &&
      ts.isIdentifier(property.name) &&
      /^(action|on(?:change|click|submit))$/i.test(property.name.text),
  );
}

function isMapCall(node: ts.Node) {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "map"
  );
}

function jsxMetrics(root: JsxNode): JsxMetrics {
  const metrics: JsxMetrics = {
    components: 0,
    conditional: false,
    formAction: false,
    graphicsOnly: true,
    mapped: false,
    maxDepth: 0,
    semanticContainers: 0,
    total: 0,
  };

  function visit(node: ts.Node, depth: number) {
    const jsx = isJsxNode(node);
    const nextDepth = jsx ? depth + 1 : depth;
    if (jsx) {
      const name = tagText(jsxTag(node));
      metrics.total += 1;
      metrics.maxDepth = Math.max(metrics.maxDepth, nextDepth);
      metrics.components += isComponentTag(jsxTag(node)) ? 1 : 0;
      metrics.formAction ||= ts.isJsxFragment(node)
        ? false
        : hasFormAction(node, name);
      metrics.graphicsOnly &&= isGraphicsTag(name);
      metrics.semanticContainers += isSemanticContainer(name) ? 1 : 0;
    }
    metrics.mapped ||= isMapCall(node);
    metrics.conditional ||= ts.isConditionalExpression(node);
    ts.forEachChild(node, (child) => visit(child, nextDepth));
  }

  visit(root, 0);
  return metrics;
}

function hasCompressionContext(node: ts.Node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (isMapCall(parent) || ts.isConditionalExpression(parent)) return true;
  }
  return false;
}

function lineSpan(sourceFile: ts.SourceFile, node: ts.Node) {
  const startLine = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  ).line;
  const endLine = sourceFile.getLineAndCharacterOfPosition(
    Math.max(node.getStart(sourceFile), node.getEnd() - 1),
  ).line;
  return { endLine, startLine };
}

function collectJsxInfo(sourceFile: ts.SourceFile) {
  const infos: JsxInfo[] = [];

  function visit(node: ts.Node) {
    if (isJsxNode(node)) {
      const span = lineSpan(sourceFile, node);
      infos.push({
        context: hasCompressionContext(node),
        endLine: span.endLine,
        metrics: jsxMetrics(node),
        node,
        startLine: span.startLine,
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return infos;
}

function collectLineEvidence(sourceFile: ts.SourceFile) {
  const evidence = new Map<number, LineEvidence>();

  function visit(node: ts.Node) {
    if (node !== sourceFile) {
      const line = sourceFile.getLineAndCharacterOfPosition(
        node.getStart(sourceFile),
      ).line;
      const current = evidence.get(line) ?? { executableNodes: 0, hasJsx: false };
      if (isJsxNode(node)) current.hasJsx = true;
      if (
        ts.isArrowFunction(node) ||
        ts.isBinaryExpression(node) ||
        ts.isCallExpression(node) ||
        ts.isConditionalExpression(node) ||
        ts.isNewExpression(node)
      ) {
        current.executableNodes += 1;
      }
      evidence.set(line, current);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return evidence;
}

function hasWarningEvidence(evidence: LineEvidence | undefined) {
  return Boolean(
    evidence && !evidence.hasJsx && evidence.executableNodes >= warningEvidenceThreshold,
  );
}

function hasComplexity(info: JsxInfo) {
  const { metrics } = info;
  return (
    info.context ||
    metrics.components > 0 ||
    metrics.conditional ||
    metrics.formAction ||
    metrics.mapped ||
    metrics.semanticContainers >= 2
  );
}

function jsxCandidates(infos: JsxInfo[]): JsxCandidate[] {
  const candidates: JsxCandidate[] = [];
  for (const info of infos) {
    const { metrics } = info;
    const line = info.startLine + 1;
    const lines = info.endLine - info.startLine + 1;
    if (metrics.total >= 20 && lines <= 2) {
      candidates.push({
        endLine: info.endLine,
        line,
        message: `JSX subtree contains ${metrics.total} elements/fragments across ${lines} lines; split the hierarchy into readable multiline source.`,
        node: info.node,
        rule: "jsx-subtree",
        severity: "error",
        startLine: info.startLine,
      });
      continue;
    }
    if (metrics.total >= 12 && lines <= 4 && hasComplexity(info)) {
      candidates.push({
        endLine: info.endLine,
        line,
        message: `Dense JSX subtree contains ${metrics.total} elements/fragments across ${lines} lines; split the structure into readable multiline source.`,
        node: info.node,
        rule: "jsx-density",
        severity: "warning",
        startLine: info.startLine,
      });
      continue;
    }
    if (
      info.context &&
      metrics.total >= 4 &&
      metrics.maxDepth >= 2 &&
      lines <= 2 &&
      !metrics.graphicsOnly
    ) {
      candidates.push({
        endLine: info.endLine,
        line,
        message: `Mapped or conditional JSX subtree contains ${metrics.total} elements/fragments across ${lines} lines; give the nested tree readable multiline structure.`,
        node: info.node,
        rule: "jsx-local-density",
        severity: "warning",
        startLine: info.startLine,
      });
    }
  }
  return candidates;
}

function overlaps(left: JsxCandidate, right: JsxCandidate) {
  return (
    left.node.getStart() < right.node.getEnd() &&
    right.node.getStart() < left.node.getEnd()
  );
}

function selectJsxCandidates(candidates: JsxCandidate[]) {
  const selected: JsxCandidate[] = [];
  for (const severity of ["error", "warning"] as const) {
    const candidatesAtSeverity = candidates
      .filter((candidate) => candidate.severity === severity)
      .sort(
        (left, right) =>
          left.node.getStart() - right.node.getStart() ||
          right.node.getEnd() - left.node.getEnd() ||
          compareText(left.rule, right.rule),
      );
    for (const candidate of candidatesAtSeverity) {
      if (!selected.some((item) => overlaps(item, candidate))) selected.push(candidate);
    }
  }
  return selected;
}

function tagName(node: ts.Node) {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  return undefined;
}

function isSqlTag(node: ts.Expression) {
  return tagName(node) === "sql";
}

function isThemeBootstrap(node: ts.NoSubstitutionTemplateLiteral) {
  const declaration = node.parent;
  return (
    ts.isVariableDeclaration(declaration) &&
    ts.isIdentifier(declaration.name) &&
    declaration.name.text === "themeBootstrap"
  );
}

function collectLiteralRanges(sourceFile: ts.SourceFile): LiteralRange[] {
  const ranges: LiteralRange[] = [];

  function visit(node: ts.Node) {
    if (ts.isTaggedTemplateExpression(node) && isSqlTag(node.tag)) {
      ranges.push({
        end: node.template.getEnd(),
        intentional: true,
        start: node.template.getStart(sourceFile),
      });
    } else if (ts.isNoSubstitutionTemplateLiteral(node)) {
      ranges.push({
        end: node.getEnd(),
        intentional: isThemeBootstrap(node),
        start: node.getStart(sourceFile),
      });
    } else if (
      ts.isStringLiteral(node) ||
      ts.isRegularExpressionLiteral(node)
    ) {
      ranges.push({
        end: node.getEnd(),
        intentional: false,
        start: node.getStart(sourceFile),
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return ranges;
}

function isCommentLine(line: string) {
  return /^\s*(?:\/\/|\/\*|\*|\*\/)/.test(line);
}

function rangeLengthOnLine(
  range: LiteralRange,
  lineStart: number,
  lineEnd: number,
) {
  return Math.max(
    0,
    Math.min(range.end, lineEnd) - Math.max(range.start, lineStart),
  );
}

function executableLineLength(
  line: string,
  lineStart: number,
  ranges: LiteralRange[],
  hasJsx: boolean,
  maskJsxLiterals: boolean,
) {
  const lineEnd = lineStart + line.length;
  const onLine = ranges.filter(
    (range) => range.start < lineEnd && range.end > lineStart,
  );
  const intentional = onLine.filter((range) => range.intentional);
  const generic = onLine.filter((range) => !range.intentional);
  const hasObjectOrArraySyntax = /[\[{]/.test(line);
  const maskGeneric =
    generic.length === 1 ||
    (maskJsxLiterals && hasJsx && generic.length > 0) ||
    (maskJsxLiterals && !hasJsx && !hasObjectOrArraySyntax && generic.length > 0);
  const masked = [...intentional, ...(maskGeneric ? generic : [])];
  const covered = masked.reduce(
    (total, range) => total + rangeLengthOnLine(range, lineStart, lineEnd),
    0,
  );
  return line.length - covered;
}

function lineDiagnostics(
  sourceFile: ts.SourceFile,
  source: string,
  ranges: LiteralRange[],
  lineEvidence: Map<number, LineEvidence>,
): DiagnosticFinding[] {
  const diagnostics: DiagnosticFinding[] = [];
  const lineStarts = sourceFile.getLineStarts();
  for (let index = 0; index < lineStarts.length; index += 1) {
    const start = lineStarts[index]!;
    const end = index + 1 < lineStarts.length ? lineStarts[index + 1]! : source.length;
    const line = source.slice(start, end).replace(/\r?\n$/, "");
    if (line.length <= warningLength || isCommentLine(line)) {
      continue;
    }
    const evidence = lineEvidence.get(index);
    const strictLength = executableLineLength(
      line,
      start,
      ranges,
      evidence?.hasJsx ?? false,
      false,
    );
    const warningLengthValue = executableLineLength(
      line,
      start,
      ranges,
      evidence?.hasJsx ?? false,
      true,
    );
    if (strictLength > errorLength) {
      diagnostics.push({
        diagnostic: {
          file: sourceFile.fileName,
          line: index + 1,
          message: `Executable source line is ${line.length} characters; split the structure into readable multiline source.`,
          rule: "line-length",
          severity: "error",
        },
        end,
        start,
      });
    } else if (
      warningLengthValue > warningLength &&
      hasWarningEvidence(evidence)
    ) {
      diagnostics.push({
        diagnostic: {
          file: sourceFile.fileName,
          line: index + 1,
          message: `Executable source line is ${line.length} characters; consider splitting the structure into readable multiline source.`,
          rule: "line-length",
          severity: "warning",
        },
        end,
        start,
      });
    }
  }
  return diagnostics;
}

function toFindings(candidates: JsxCandidate[], file: string): DiagnosticFinding[] {
  return candidates.map(({ line, message, node, rule, severity }) => ({
    diagnostic: { file, line, message, rule, severity },
    end: node.getEnd(),
    start: node.getStart(),
  }));
}

function findingOverlaps(left: DiagnosticFinding, right: DiagnosticFinding) {
  return left.start < right.end && right.start < left.end;
}

function deduplicateFindings(
  jsxFindings: DiagnosticFinding[],
  lineFindings: DiagnosticFinding[],
) {
  const jsxErrors = jsxFindings.filter(
    ({ diagnostic }) => diagnostic.severity === "error",
  );
  const lineErrors = lineFindings.filter(
    ({ diagnostic }) => diagnostic.severity === "error",
  );
  return [
    ...jsxFindings.filter(
      (finding) =>
        finding.diagnostic.severity === "error" ||
        !lineErrors.some((lineFinding) => findingOverlaps(finding, lineFinding)),
    ),
    ...lineFindings.filter((finding) =>
      finding.diagnostic.severity === "error"
        ? !jsxErrors.some((jsxFinding) => findingOverlaps(finding, jsxFinding))
        : !jsxFindings.some((jsxFinding) => findingOverlaps(finding, jsxFinding)),
    ),
  ].map(({ diagnostic }) => diagnostic);
}

function severityOrder(severity: ReadabilitySeverity) {
  return severity === "error" ? 0 : 1;
}

function normalizedPath(file: string) {
  return file.split(path.sep).join("/");
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function sortDiagnostics(diagnostics: ReadabilityDiagnostic[]) {
  return [...diagnostics].sort(
    (left, right) =>
      severityOrder(left.severity) - severityOrder(right.severity) ||
      compareText(normalizedPath(left.file), normalizedPath(right.file)) ||
      left.line - right.line ||
      compareText(left.rule, right.rule) ||
      compareText(left.message, right.message),
  );
}

export function checkSourceText(source: string, fileName: string) {
  const sourceFile = parseSource(source, fileName);
  const infos = collectJsxInfo(sourceFile);
  const candidates = selectJsxCandidates(jsxCandidates(infos));
  const diagnostics = deduplicateFindings(
    toFindings(candidates, fileName),
    lineDiagnostics(
      sourceFile,
      source,
      collectLiteralRanges(sourceFile),
      collectLineEvidence(sourceFile),
    ),
  );
  return sortDiagnostics(diagnostics);
}

function isProductionSource(root: string, file: string) {
  const relative = normalizedPath(path.relative(root, file));
  return (
    /\.(?:ts|tsx)$/.test(relative) &&
    !/\.d\.ts$/.test(relative) &&
    !/\.(?:test|spec)\.[^.]+$/.test(relative) &&
    !/(^|\/)(?:test|tests|__tests__|generated|migrations|vendor)(\/|$)/.test(relative)
  );
}

export function scanProject(root = projectRoot): ReadabilityReport {
  const startedAt = Date.now();
  const sourceRoot = path.join(root, sourceRootName);
  const files = ts.sys
    .readDirectory(sourceRoot, [".ts", ".tsx"])
    .filter((file) => isProductionSource(root, file))
    .sort((left, right) => compareText(normalizedPath(left), normalizedPath(right)));
  const diagnostics = sortDiagnostics(
    files.flatMap((file) => {
      const source = ts.sys.readFile(file);
      return source === undefined ? [] : checkSourceText(source, file);
    }),
  );
  return {
    diagnostics,
    filesScanned: files.length,
    runtimeMs: Date.now() - startedAt,
  };
}

export function checkProject(root = projectRoot) {
  return scanProject(root).diagnostics;
}

export function exitCode(diagnostics: ReadabilityDiagnostic[]) {
  return diagnostics.some(({ severity }) => severity === "error") ? 1 : 0;
}

export function formatDiagnostic(
  diagnostic: ReadabilityDiagnostic,
  root = projectRoot,
) {
  return `${normalizedPath(path.relative(root, diagnostic.file))}:${diagnostic.line} readability/${diagnostic.severity} ${diagnostic.rule} ${diagnostic.message}`;
}

function main() {
  const report = scanProject();
  for (const diagnostic of report.diagnostics) {
    console.error(formatDiagnostic(diagnostic));
  }
  const warnings = report.diagnostics.filter(
    ({ severity }) => severity === "warning",
  ).length;
  const errors = report.diagnostics.length - warnings;
  console.log(
    `Readability check: ${report.filesScanned} files scanned, ${warnings} warnings, ${errors} errors (${report.runtimeMs}ms).`,
  );
  process.exitCode = exitCode(report.diagnostics);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
