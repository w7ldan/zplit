import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(projectRoot, "src");

export type BoundaryViolation = {
  file: string;
  line: number;
  message: string;
};

function hasDirective(sourceFile: ts.SourceFile, directive: string) {
  const statement = sourceFile.statements[0];
  return Boolean(statement && ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression) && statement.expression.text === directive);
}

function isExported(node: ts.Node) {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword) ?? false);
}

function isAsync(node: ts.Node) {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some(({ kind }) => kind === ts.SyntaxKind.AsyncKeyword) ?? false);
}

function violation(sourceFile: ts.SourceFile, node: ts.Node, message: string): BoundaryViolation {
  return { file: sourceFile.fileName, line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1, message };
}

function moduleSpecifierText(node: ts.ImportDeclaration | ts.ExportDeclaration) {
  return node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : undefined;
}

function isWithin(directory: string, candidate: string) {
  const relative = path.relative(directory, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function implementationPath(importer: string, moduleName: string) {
  if (moduleName.startsWith("@/")) return path.resolve(sourceRoot, moduleName.slice(2));
  if (moduleName.startsWith(".")) return path.resolve(path.dirname(importer), moduleName);
  return undefined;
}

function isServerOrDatabaseModule(importer: string, moduleName: string) {
  const resolved = implementationPath(importer, moduleName);
  return Boolean(resolved && (isWithin(path.join(sourceRoot, "server"), resolved) || isWithin(path.join(sourceRoot, "db"), resolved)));
}

function checkClientImports(sourceFile: ts.SourceFile): BoundaryViolation[] {
  const violations: BoundaryViolation[] = [];
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) {
      const moduleName = moduleSpecifierText(statement);
      if (moduleName && isServerOrDatabaseModule(sourceFile.fileName, moduleName)) {
        violations.push(violation(sourceFile, statement, `Client Components cannot import or re-export server/database module "${moduleName}".`));
      }
    }
    if (ts.isImportEqualsDeclaration(statement) && ts.isExternalModuleReference(statement.moduleReference) && ts.isStringLiteral(statement.moduleReference.expression) && isServerOrDatabaseModule(sourceFile.fileName, statement.moduleReference.expression.text)) {
      violations.push(violation(sourceFile, statement, `Client Components cannot import server/database module "${statement.moduleReference.expression.text}".`));
    }
  }
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && isServerOrDatabaseModule(sourceFile.fileName, node.arguments[0].text)) {
      violations.push(violation(sourceFile, node, `Client Components cannot dynamically import server/database module "${node.arguments[0].text}".`));
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return violations;
}

function unwrap(expression: ts.Expression): ts.Expression {
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) return unwrap(expression.expression);
  return expression;
}

function localDeclarations(sourceFile: ts.SourceFile) {
  const declarations = new Map<string, ts.Declaration>();
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) declarations.set(statement.name.text, statement);
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) declarations.set(declaration.name.text, declaration);
      }
    }
  }
  return declarations;
}

function isAsyncValue(expression: ts.Expression | undefined, declarations: Map<string, ts.Declaration>, resolving = new Set<string>()): boolean {
  if (!expression) return false;
  const value = unwrap(expression);
  if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) return isAsync(value);
  if (!ts.isIdentifier(value) || resolving.has(value.text)) return false;
  const declaration = declarations.get(value.text);
  if (!declaration) return false;
  resolving.add(value.text);
  const result = ts.isFunctionDeclaration(declaration) ? isAsync(declaration) : ts.isVariableDeclaration(declaration) && isAsyncValue(declaration.initializer, declarations, resolving);
  resolving.delete(value.text);
  return result;
}

function checkExportedVariables(sourceFile: ts.SourceFile, statement: ts.VariableStatement, declarations: Map<string, ts.Declaration>, reject: (node: ts.Node, name: string) => void) {
  for (const declaration of statement.declarationList.declarations) {
    const name = ts.isIdentifier(declaration.name) ? declaration.name.text : declaration.name.getText(sourceFile);
    if (!isAsyncValue(declaration.initializer, declarations)) reject(declaration, name);
  }
}

function checkExportedRuntimeDeclaration(sourceFile: ts.SourceFile, statement: ts.Statement, reject: (node: ts.Node, name: string) => void) {
  if (!isExported(statement)) return;
  if (ts.isFunctionDeclaration(statement)) {
    if (!isAsync(statement)) reject(statement, statement.name?.text ?? "default");
    return;
  }
  if (ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement) || ts.isModuleDeclaration(statement) || ts.isImportEqualsDeclaration(statement)) reject(statement, statement.name?.getText(sourceFile) ?? "default");
}

function checkExportedDeclarations(sourceFile: ts.SourceFile, statement: ts.ExportDeclaration, declarations: Map<string, ts.Declaration>, reject: (node: ts.Node, name: string) => void) {
  if (statement.isTypeOnly) return;
  if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) {
    reject(statement, "*");
    return;
  }
  for (const element of statement.exportClause.elements) {
    if (element.isTypeOnly) continue;
    const localName = element.propertyName?.text ?? element.name.text;
    if (statement.moduleSpecifier || !isAsyncValue(ts.factory.createIdentifier(localName), declarations)) reject(element, element.name.text);
  }
}

function checkServerExports(sourceFile: ts.SourceFile): BoundaryViolation[] {
  const violations: BoundaryViolation[] = [];
  const declarations = localDeclarations(sourceFile);
  const reject = (node: ts.Node, name: string) => violations.push(violation(sourceFile, node, `"use server" runtime export "${name}" must be an async Server Action.`));

  for (const statement of sourceFile.statements) {
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) continue;
    if (ts.isVariableStatement(statement) && isExported(statement)) {
      checkExportedVariables(sourceFile, statement, declarations, reject);
      continue;
    }
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement) || ts.isModuleDeclaration(statement) || ts.isImportEqualsDeclaration(statement)) {
      checkExportedRuntimeDeclaration(sourceFile, statement, reject);
      continue;
    }
    if (ts.isExportAssignment(statement)) {
      if (statement.isExportEquals || !isAsyncValue(statement.expression, declarations)) reject(statement, "default");
      continue;
    }
    if (ts.isExportDeclaration(statement)) checkExportedDeclarations(sourceFile, statement, declarations, reject);
  }
  return violations;
}

export function checkSourceText(source: string, fileName: string): BoundaryViolation[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  if (hasDirective(sourceFile, "use client")) return checkClientImports(sourceFile);
  if (hasDirective(sourceFile, "use server")) return checkServerExports(sourceFile);
  return [];
}

export function checkProject(root = projectRoot): BoundaryViolation[] {
  const files = ts.sys.readDirectory(path.join(root, "src"), [".ts", ".tsx"]);
  return files.flatMap((file) => {
    const source = ts.sys.readFile(file);
    return source === undefined ? [] : checkSourceText(source, file);
  });
}

function main() {
  const violations = checkProject();
  if (violations.length) {
    for (const item of violations) console.error(`${path.relative(projectRoot, item.file)}:${item.line} ${item.message}`);
    process.exitCode = 1;
    return;
  }
  console.log("Next.js boundary check passed.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
