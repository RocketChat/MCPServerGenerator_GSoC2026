<h1 align="center">Rocket.Chat MCP Server Generator</h1>

<p align="center">
  A <a href="https://github.com/google-gemini/gemini-cli">gemini-cli</a> extension that generates <strong>minimal</strong>, <strong>workflow-driven</strong> MCP servers — solving context bloat by exposing only the workflows a project actually needs.
</p>

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg" alt="Node.js >= 22"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.8-blue.svg" alt="TypeScript"></a>
  <a href="https://modelcontextprotocol.io/"><img src="https://img.shields.io/badge/MCP-1.27-purple.svg" alt="MCP SDK"></a>
  <a href="https://rocket.chat/"><img src="https://img.shields.io/badge/Rocket.Chat-558%20endpoints-red.svg" alt="558 Endpoints"></a>
</p>

---

## The Problem

A major pain point when adopting MCP is **context bloat**. Most MCP servers ship support for a large surface of service APIs, so anyone adopting them spends most of their token budget on static tool definitions for calls they will never make. In agentic code-generation workflows this is worse — every agent burns tokens in loops carrying tools the project will never use.

## The Solution

This generator lets you create a **minimal** MCP server that covers only the subset of APIs your project actually needs. Describe what you want in plain English; the generator finds the relevant REST APIs, composes multi-step workflow tools that chain those API calls with AI reasoning, and outputs a complete, runnable MCP server project.

The output is **not** a thin REST wrapper. Each generated tool is a **workflow** that chains multiple API calls, LLM reasoning, user confirmation, data transforms, and conditional logic into one higher-level operation — invoked from any MCP-compatible client such as Gemini CLI, Claude Desktop, Cursor, or VS Code Copilot.

## How It Works

It is itself an MCP server that exposes three tools. An AI client calls them in sequence:

| Tool | Purpose |
| --- | --- |
| **`get_capability_guide`** | Discovers and lists the available REST API endpoints |
| **`get_endpoint_schemas`** | Returns exact request/response schemas for the chosen endpoints |
| **`generate`** | Validates the described workflows and writes a complete MCP server project |

```
Describe intent -> get_capability_guide -> get_endpoint_schemas -> generate -> ready to deploy
```

You describe the goal in natural language; the AI handles endpoint selection, workflow composition, and code generation autonomously.

## Key Capabilities

- **Plain-English to working server** — go from an idea to a complete, tested MCP server project without writing the integration by hand.
- **Workflow tools, not raw endpoints** — each tool composes API calls, AI reasoning (sampling), human-in-the-loop confirmation (elicitation), data transforms, and conditional branching.
- **Minimal by design** — only the workflows you ask for are generated, keeping the token footprint small.
- **Automatic API discovery** — fetches official OpenAPI specs at runtime (558 Rocket.Chat endpoints across 12 domains), so new endpoints are available without manual definitions.
- **Complete project output** — every generated server includes source, a runtime workflow engine, tests, configuration, and a README.
- **Two ways to run** — as a Gemini CLI extension (AI-driven), or as a standalone MCP server for deterministic generation.

## Prerequisites

- [Node.js](https://nodejs.org/) v22 or newer
- [gemini-cli](https://github.com/google-gemini/gemini-cli) installed and configured (for the AI-driven flow)

## Quick Start

Install as a Gemini CLI extension, then describe what you need:

```
gemini> I need an MCP server that can send messages and manage channels
```

Gemini discovers the right endpoints, composes the workflows, and generates a complete project — ready to install and run.

## Building & Testing

```bash
npm install
npm test
npm run build
```

## Documentation

- **[Architecture & High-Level Design](docs/ARCHITECTURE.md)** — how the system fits together
- **[DSL Reference](docs/DSL_REFERENCE.md)** — the complete DSL language spec
- **[Generated Project Anatomy](docs/GENERATED_PROJECT.md)** — what the output looks like
- **[Security Model](docs/SECURITY.md)** — sandbox, allowlist, and threat model
- **[Testing Guide](docs/TESTING.md)** — test suite map and conventions
- **[Contributing](CONTRIBUTING.md)** — setup, workflow, and contribution guide

## License

[MIT](LICENSE)
