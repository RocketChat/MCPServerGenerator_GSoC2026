# Testing Guide

> A map of the test suite, what each area covers, how to run subsets, and how to add new tests. Tests use Node's built-in runner (`node:test`) with `node:assert/strict` and `tsx` for TypeScript.

---

## 1. How to Run

| Command | Runs |
| --- | --- |
| `npm test` | The full test suite |
| `npm run build` | Compile TypeScript (build verification) |

Run a single file directly:

```bash
npx tsx --test src/tests/dsl/parser.unit.test.ts
```

---

## 2. The Test Tree

```
src/tests/
├── dsl/                    # DSL parser + scanner
├── parser/                 # OpenAPI fetch, extract, schema, fuzzy
├── tools/                  # MCP tool handlers + protocol smoke
├── utils/                  # operationId resolver
├── generator/              # code generation integration
├── workflow/               # engine, executor, sandbox, security
└── integration/            # full pipeline end-to-end
```

Naming conventions:
- `*.unit.test.ts` — isolated module behavior
- `*.integration.test.ts` — behavior spanning modules
- `*.smoke.test.ts` — MCP protocol / end-to-end sanity

---

## 3. What Each Area Covers

### 3.1 `dsl/` — DSL parser & scanner

| File | Focus |
| --- | --- |
| `scanner.unit.test.ts` | Line iteration, blank/comment skipping, heredoc collection |
| `parser.unit.test.ts` | Overall parse of valid documents |
| `parser-errors.unit.test.ts` | Every parse-time error |
| `parser-integration.unit.test.ts` | Complex multi-workflow documents |

### 3.2 `parser/` — OpenAPI parsing

| File | Focus |
| --- | --- |
| `spec-source.unit.test.ts` | Cache tiers, TTL, URL building |
| `endpoint-extraction.unit.test.ts` | Compact/full extraction, id sanitize/dedupe |
| `schema-mapper.unit.test.ts` | OpenAPI -> JSON Schema, nullable, cycle/depth guards |
| `fuzzy-match.unit.test.ts` | Exact/normalized/fuzzy operationId matching |
| `spec-parser.unit.test.ts` | SpecParser orchestration |
| `get-full-endpoints.integration.test.ts` | Fast/slow/fuzzy paths |
| `index.integration.test.ts` | Parser public surface |
| `cache-and-stats.integration.test.ts` | Caching behavior |

### 3.3 `tools/` — MCP tool handlers

| File | Focus |
| --- | --- |
| `format-capability-guide.unit.test.ts` | Guide formatting, grouping |
| `get-capability-guide.unit.test.ts` | Discovery handler |
| `get-endpoint-schemas.unit.test.ts` | Schema handler, corrected/unmatched ids |
| `mcp-protocol.smoke.test.ts` | `listTools`/`callTool` protocol surface |
| `annotations.integration.test.ts` | Endpoint annotations |

### 3.4 `workflow/` — runtime engine

| File | Focus |
| --- | --- |
| `executor.integration.test.ts` | Execution loop, step scheduling, branching |
| `sandbox-security.unit.test.ts` | Sandbox escapes are blocked |

### 3.5 `generator/` — code generation

| File | Focus |
| --- | --- |
| `generate.integration.test.ts` | MCP tool invocation and project output |
| `pipeline.integration.test.ts` | DSL string -> generated project (full pipeline) |

### 3.6 `integration/` — full pipeline

| File | Focus |
| --- | --- |
| `pipeline.integration.test.ts` | End-to-end: DSL -> compose -> generate -> validate output |

---

## 4. Testing Conventions

- **Use narrow interfaces for mocks.** Tool handler tests can implement source interfaces with only the needed methods.
- **Assert behavior, not implementation.** Prefer asserting on produced `WorkflowDefinition`, generated file content, or engine results.
- **Keep tests focused.** One test file per behavior area.

---

## 5. Adding Tests

When changing the **parser**, cover: exact operationId matches, fuzzy-corrected ids, unmatched ids, request-body extraction, path/query/header parameters, and response schema output.

When changing the **composer** or **engine**, cover the normalization/validation rule you touched and at least one end-to-end case.

When changing **MCP tool surface**, add or update a smoke test around `listTools()`/`callTool()`.
