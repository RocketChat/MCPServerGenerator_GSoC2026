# Contributing

Thanks for helping improve the Rocket.Chat MCP Server Generator. This guide covers everything you need to set up, develop, test, and submit changes.

---

## Prerequisites

- **Node.js 22 or newer**
- **npm**
- **Git**
- **gemini-cli** — optional, only if you want to test the repo as a Gemini extension

## Setup

Clone and install:

```bash
git clone https://github.com/RocketChat/MCPServerGenerator_GSoC2026.git
cd MCPServerGenerator_GSoC2026
npm install
```

Verify your environment:

```bash
npm run typecheck
npm test
npm run build
```

## Everyday Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Run the MCP server from source (via `tsx`) for local iteration |
| `npm start` | Run the compiled server from `dist/` |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run typecheck` | Type-check without emitting files |
| `npm test` | Run the full unit/integration test suite |
| `npm run lint` / `npm run lint:fix` | Lint (and auto-fix) with ESLint |
| `npm run format` / `npm run format:check` | Format (and check) with Prettier |
| `npm run check` | Everything above, gate-style — run this before pushing |

## Development Workflow

1. Create a branch with a descriptive name, e.g. `fix/schema-output` or `docs/dsl-reference`.
2. Make focused changes. Keep refactors out of feature/bug-fix PRs unless required for the fix.
3. Add or update tests for new behavior.
4. Run `npm run check` and make sure it passes.
5. Open a pull request (see the checklist below).

## Coding Conventions

- **TypeScript strict mode**, ESM syntax.
- Local imports must include the runtime `.js` extension: `import { createMcpServer } from "./server.js";`.
- **Lint & format are enforced.** ESLint + Prettier run in `npm run check`.
- **Logging goes to stderr.** Never write to stdout in the MCP server — stdout is the JSON-RPC channel. Use `console.error`.
- **Prefer narrow interfaces.** Tool handlers should depend on small contracts instead of concrete classes — this keeps handlers testable.
- Keep tool handlers focused on MCP response shaping; put parsing and workflow logic in the parser/composer/workflow modules.
- Use lowercase, hyphenated filenames for multi-word modules (e.g. `get-endpoint-schemas.ts`).

## Where Things Live

The source is organized by responsibility under `src/`:

| Directory | Responsibility |
| --- | --- |
| `src/tools/` | The three MCP tool handlers |
| `src/dsl/` | DSL parser (scanner + recursive descent parser) |
| `src/composer/` | Workflow validation, normalization, inference, ordering |
| `src/generator/` | Code generation pipeline |
| `src/parser/` | OpenAPI fetch, cache, endpoint extraction |
| `src/workflow/` | Runtime engine (executor, templates, sandbox, security) |
| `src/utils/` | operationId resolver |

For a full explanation of the architecture, read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Testing Conventions

Tests use Node's built-in `node:test` with `node:assert/strict`. Tests live under `src/tests/`, grouped by area. Place new tests in the folder matching the module you're changing.

When changing **parser** behavior, cover: exact operationId matches, fuzzy-corrected ids, unmatched ids, request-body extraction, and response schema output.

When changing the **composer** or **workflow engine**, cover the normalization/validation rule you touched and at least one end-to-end case.

See [`docs/TESTING.md`](docs/TESTING.md) for the full test suite map.

## Pull Request Checklist

Before requesting review:

- [ ] `npm run check` passes (format, lint, types, tests, build)
- [ ] New behavior has focused tests
- [ ] Public MCP tool behavior is documented or covered by a smoke test
- [ ] Relevant docs updated if behavior or structure changed
