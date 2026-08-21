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
  [
    "Number",
    new Set(["isFinite", "isInteger", "isNaN", "parseFloat", "parseInt"]),
  ],
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

const ALLOWED_GLOBALS = new Set([
  ...SAFE_IDENTIFIER_CALLS,
  ...SAFE_STATIC_CALLS.keys(),
  "undefined",
  "null",
  "true",
  "false",
  "NaN",
  "Infinity",
]);

const BLOCKED_PROPERTIES = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Maximum AST nesting depth accepted by {@link validateSafeExpression}.
 *
 * `validateNode` is recursive, so a pathologically nested expression could in
 * principle exhaust the call stack. The surrounding try/catch already converts
 * any overflow into a rejection, but V8's stack limit is platform-dependent —
 * this explicit, deterministic bound makes the rejection point predictable and
 * yields a clear message instead of "Maximum call stack size exceeded". The
 * limit is far above any realistic hand- or AI-authored expression.
 */
const MAX_AST_DEPTH = 500;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Acorn nodes are inspected structurally by node type.
type Node = Record<string, any>;

/**
 * Reject expressions nested deeper than {@link MAX_AST_DEPTH}. Uses an explicit
 * work stack (no recursion) so the guard itself cannot overflow, and skips
 * acorn's positional bookkeeping keys so only structural nesting counts.
 */
function assertBoundedDepth(ast: Node): void {
  const stack: Array<{ node: unknown; depth: number }> = [
    { node: ast, depth: 0 },
  ];
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (depth > MAX_AST_DEPTH) {
      reject(`expression nesting too deep (max ${MAX_AST_DEPTH})`);
    }
    if (!node || typeof node !== "object") continue;
    for (const key of Object.keys(node as Record<string, unknown>)) {
      if (key === "type" || key === "start" || key === "end") continue;
      const child = (node as Record<string, unknown>)[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === "object")
            stack.push({ node: item, depth: depth + 1 });
        }
      } else if (child && typeof child === "object") {
        stack.push({ node: child, depth: depth + 1 });
      }
    }
  }
}

export function validateSafeExpression(
  expr: string,
  context: string,
  additionalIdentifiers?: Iterable<string>,
): void {
  const trimmed = expr.trim();
  if (!trimmed) return;

  try {
    const ast = parseAsExpression(trimmed) ?? parseAsProgram(trimmed);
    assertBoundedDepth(ast);
    const scope = new Scope(additionalIdentifiers);
    validateNode(ast, scope);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Unsafe ${context} expression rejected: "${expr}". ${detail}`,
      { cause: err },
    );
  }
}

export function autoReturnExpression(expr: string): string {
  if (isValidSyntax(expr)) return expr;

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

  if (isValidFunctionBody(candidate)) return candidate;
  return expr;
}

function isValidSyntax(code: string): boolean {
  try {
    parse(code, { ecmaVersion: "latest", sourceType: "script" });
    return true;
  } catch {
    return false;
  }
}

function isValidFunctionBody(code: string): boolean {
  try {
    parse(`function __check__() { ${code} }`, {
      ecmaVersion: "latest",
      sourceType: "script",
    });
    return true;
  } catch {
    return false;
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
  private readonly frames: Array<Set<string>>;

  constructor(additionalIdentifiers?: Iterable<string>) {
    const base = new Set(["params", "steps"]);
    if (additionalIdentifiers) {
      for (const id of additionalIdentifiers) base.add(id);
    }
    this.frames = [base];
  }

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
    case "SpreadElement":
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

function validateList(
  nodes: Array<Node | null | undefined>,
  scope: Scope,
): void {
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
  if (node.computed && property === null) {
    reject(
      "computed property access with dynamic keys is not allowed — use dot notation or a literal key",
    );
  }
  validateNode(node.object, scope);
  if (node.computed) validateNode(node.property, scope);
}

function validateIdentifier(name: string, scope: Scope): void {
  if (scope.has(name)) return;
  if (ALLOWED_GLOBALS.has(name)) return;
  reject(`identifier "${name}" is not allowed`);
}

function validateMutationTarget(node: Node, scope: Scope): void {
  if (node.type === "Identifier") {
    if (!scope.has(node.name)) {
      reject(
        `assignment to undeclared identifier "${node.name}" is not allowed`,
      );
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

const RESERVED_SCOPE_NAMES = new Set(["params", "steps"]);

function patternNames(node: Node): string[] {
  switch (node.type) {
    case "Identifier":
      if (RESERVED_SCOPE_NAMES.has(node.name)) {
        reject(
          `cannot declare variable "${node.name}" — it shadows a reserved name`,
        );
      }
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
  while (
    current.type === "MemberExpression" ||
    current.type === "ChainExpression"
  ) {
    current =
      current.type === "ChainExpression" ? current.expression : current.object;
  }
  return current.type === "Identifier" ? current.name : null;
}

function propertyName(node: Node): string | null {
  if (node.computed) {
    return node.property.type === "Literal"
      ? String(node.property.value)
      : null;
  }
  return node.property.type === "Identifier" ? node.property.name : null;
}

function reject(message: string): never {
  throw new Error(message);
}
