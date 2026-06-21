import { parse } from "acorn";

const SAFE_METHODS = new Set([
  "at",
  "charAt",
  "charCodeAt",
  "codePointAt",
  "concat",
  "copyWithin",
  "endsWith",
  "entries",
  "every",
  "filter",
  "find",
  "findIndex",
  "flat",
  "flatMap",
  "forEach",
  "includes",
  "indexOf",
  "join",
  "keys",
  "lastIndexOf",
  "map",
  "match",
  "matchAll",
  "normalize",
  "padEnd",
  "padStart",
  "pop",
  "push",
  "reduce",
  "repeat",
  "replace",
  "replaceAll",
  "reverse",
  "search",
  "shift",
  "slice",
  "some",
  "sort",
  "split",
  "startsWith",
  "substring",
  "substr",
  "toJSON",
  "toLowerCase",
  "toString",
  "toUpperCase",
  "trim",
  "trimEnd",
  "trimStart",
  "unshift",
  "valueOf",
  "values",
]);

const SAFE_STATIC_CALLS = new Map([
  ["Array", new Set(["isArray", "from"])],
  ["Date", new Set(["now", "parse"])],
  ["JSON", new Set(["parse", "stringify"])],
  ["Math", new Set(Object.getOwnPropertyNames(Math))],
  ["Number", new Set(["isFinite", "isInteger", "isNaN", "parseFloat", "parseInt"])],
  ["Object", new Set(["entries", "fromEntries", "keys", "values"])],
  ["String", new Set(["raw"])],
]);

const SAFE_IDENTIFIER_CALLS = new Set([
  "Boolean",
  "Number",
  "String",
  "decodeURIComponent",
  "encodeURIComponent",
  "isFinite",
  "isNaN",
  "parseFloat",
  "parseInt",
]);

const BLOCKED_IDENTIFIERS = new Set([
  "Function",
  "arguments",
  "console",
  "eval",
  "global",
  "globalThis",
  "import",
  "module",
  "process",
  "require",
  "window",
]);

const BLOCKED_PROPERTIES = new Set(["__proto__", "constructor", "prototype"]);

type Node = Record<string, any>;

export function validateSafeExpression(expr: string, context: string): void {
  const trimmed = expr.trim();
  if (!trimmed) return;

  try {
    const ast = parseAsExpression(trimmed) ?? parseAsProgram(trimmed);
    const scope = new Scope();
    validateNode(ast, scope);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Unsafe ${context} expression rejected: "${expr}". ${detail}`,
    );
  }
}

export function autoReturnExpression(expr: string): string {
  try {
    new Function(`"use strict"; ${expr}`);
    return expr;
  } catch {
    // continue to fixup
  }

  const trimmed = expr.trimEnd();
  if (!trimmed.endsWith("}")) return expr;

  let depth = 0;
  let objStart = -1;
  for (let i = trimmed.length - 1; i >= 0; i--) {
    if (trimmed[i] === "}") depth++;
    else if (trimmed[i] === "{") {
      depth--;
      if (depth === 0) {
        objStart = i;
        break;
      }
    }
  }
  if (objStart <= 0) return expr;

  const before = trimmed.substring(0, objStart).trimEnd();
  if (before.endsWith(")") || before.endsWith("else")) return expr;

  const objPart = trimmed.substring(objStart);
  const stmtPart = before.endsWith(";") ? before : before + ";";
  const candidate = `${stmtPart} return (${objPart});`;

  try {
    new Function(`"use strict"; ${candidate}`);
    return candidate;
  } catch {
    return expr;
  }
}

function parseAsExpression(expr: string): Node | null {
  try {
    const program = parse(`(${expr});`, {
      ecmaVersion: "latest",
      sourceType: "script",
    }) as Node;
    return program;
  } catch {
    return null;
  }
}

function parseAsProgram(expr: string): Node {
  try {
    return parse(expr, {
      ecmaVersion: "latest",
      sourceType: "script",
    }) as Node;
  } catch {
    const program = parse(`function __workflowExpression__() { ${expr} }`, {
      ecmaVersion: "latest",
      sourceType: "script",
    }) as Node;
    return program.body[0].body;
  }
}

class Scope {
  private readonly frames: Array<Set<string>> = [new Set(["params", "steps"])];

  has(name: string): boolean {
    return this.frames.some((frame) => frame.has(name));
  }

  declare(name: string): void {
    this.frames[this.frames.length - 1].add(name);
  }

  child<T>(names: string[], fn: () => T): T {
    this.frames.push(new Set(names));
    try {
      return fn();
    } finally {
      this.frames.pop();
    }
  }
}

function validateNode(node: Node | null | undefined, scope: Scope): void {
  if (!node) return;

  switch (node.type) {
    case "ArrayExpression":
      validateList(node.elements, scope);
      return;
    case "ArrowFunctionExpression":
      validateArrowFunction(node, scope);
      return;
    case "AssignmentExpression":
      validateAssignment(node, scope);
      return;
    case "BinaryExpression":
    case "LogicalExpression":
      validateNode(node.left, scope);
      validateNode(node.right, scope);
      return;
    case "BlockStatement":
      scope.child([], () => validateList(node.body, scope));
      return;
    case "CallExpression":
      validateCallExpression(node, scope);
      return;
    case "ChainExpression":
      validateNode(node.expression, scope);
      return;
    case "ConditionalExpression":
      validateNode(node.test, scope);
      validateNode(node.consequent, scope);
      validateNode(node.alternate, scope);
      return;
    case "ExpressionStatement":
      validateNode(node.expression, scope);
      return;
    case "Identifier":
      validateIdentifier(node.name, scope);
      return;
    case "IfStatement":
      validateNode(node.test, scope);
      validateNode(node.consequent, scope);
      validateNode(node.alternate, scope);
      return;
    case "Literal":
      return;
    case "MemberExpression":
      validateMemberExpression(node, scope);
      return;
    case "ObjectExpression":
      validateList(node.properties, scope);
      return;
    case "Property":
      if (node.computed) validateNode(node.key, scope);
      validateNode(node.value, scope);
      return;
    case "Program":
      validateList(node.body, scope);
      return;
    case "ReturnStatement":
      validateNode(node.argument, scope);
      return;
    case "TemplateElement":
      return;
    case "TemplateLiteral":
      validateList(node.expressions, scope);
      return;
    case "UnaryExpression":
      validateNode(node.argument, scope);
      return;
    case "UpdateExpression":
      validateMutationTarget(node.argument, scope);
      return;
    case "VariableDeclaration":
      if (node.kind === "var") reject("var declarations are not allowed");
      validateList(node.declarations, scope);
      return;
    case "VariableDeclarator":
      declarePattern(node.id, scope);
      validateNode(node.init, scope);
      return;
    default:
      reject(`${node.type} is not allowed`);
  }
}

function validateList(nodes: Array<Node | null | undefined>, scope: Scope): void {
  for (const child of nodes) validateNode(child, scope);
}

function validateArrowFunction(node: Node, scope: Scope): void {
  const names = node.params.flatMap(patternNames);
  scope.child(names, () => validateNode(node.body, scope));
}

function validateAssignment(node: Node, scope: Scope): void {
  validateMutationTarget(node.left, scope);
  validateNode(node.right, scope);
}

function validateCallExpression(node: Node, scope: Scope): void {
  if (!isSafeCallee(node.callee, scope)) {
    reject("only approved function and method calls are allowed");
  }
  validateList(node.arguments, scope);
}

function isSafeCallee(callee: Node, scope: Scope): boolean {
  if (callee.type === "ChainExpression") {
    return isSafeCallee(callee.expression, scope);
  }

  if (callee.type === "Identifier") {
    validateIdentifier(callee.name, scope);
    return SAFE_IDENTIFIER_CALLS.has(callee.name);
  }

  if (callee.type !== "MemberExpression") return false;

  const property = propertyName(callee);
  if (!property || BLOCKED_PROPERTIES.has(property)) return false;

  const root = memberRootName(callee);
  if (root) {
    validateIdentifier(root, scope);
    const staticMethods = SAFE_STATIC_CALLS.get(root);
    if (staticMethods) return staticMethods.has(property);
  }

  validateMemberExpression(callee, scope);
  return SAFE_METHODS.has(property);
}

function validateMemberExpression(node: Node, scope: Scope): void {
  const property = propertyName(node);
  if (property && BLOCKED_PROPERTIES.has(property)) {
    reject(`property "${property}" is not allowed`);
  }
  validateNode(node.object, scope);
  if (node.computed) validateNode(node.property, scope);
}

function validateIdentifier(name: string, scope: Scope): void {
  if (BLOCKED_IDENTIFIERS.has(name)) {
    reject(`identifier "${name}" is not allowed`);
  }

  // Unknown identifiers are allowed for generated workflows because the engine
  // exposes valid param keys and forEach aliases as scoped arguments.
  if (!scope.has(name)) return;
}

function validateMutationTarget(node: Node, scope: Scope): void {
  if (node.type === "Identifier") {
    if (!scope.has(node.name)) {
      reject(`assignment to undeclared identifier "${node.name}" is not allowed`);
    }
    validateIdentifier(node.name, scope);
    return;
  }

  if (node.type === "MemberExpression") {
    const root = memberRootName(node);
    if (!root || !scope.has(root) || root === "params" || root === "steps") {
      reject("only local variables can be mutated");
    }
    validateMemberExpression(node, scope);
    return;
  }

  reject(`${node.type} cannot be assigned to`);
}

function declarePattern(node: Node, scope: Scope): void {
  for (const name of patternNames(node)) scope.declare(name);
}

function patternNames(node: Node): string[] {
  switch (node.type) {
    case "Identifier":
      validateIdentifier(node.name, new Scope());
      return [node.name];
    case "ArrayPattern":
      return node.elements.flatMap((item: Node | null) =>
        item ? patternNames(item) : [],
      );
    case "AssignmentPattern":
      return patternNames(node.left);
    case "ObjectPattern":
      return node.properties.flatMap((property: Node) =>
        patternNames(property.value ?? property.argument),
      );
    case "RestElement":
      return patternNames(node.argument);
    default:
      reject(`${node.type} is not allowed in binding patterns`);
  }
}

function memberRootName(node: Node): string | null {
  let current = node;
  while (current.type === "MemberExpression" || current.type === "ChainExpression") {
    current = current.type === "ChainExpression" ? current.expression : current.object;
  }
  return current.type === "Identifier" ? current.name : null;
}

function propertyName(node: Node): string | null {
  if (node.computed) {
    return node.property.type === "Literal" ? String(node.property.value) : null;
  }
  return node.property.type === "Identifier" ? node.property.name : null;
}

function reject(message: string): never {
  throw new Error(message);
}
