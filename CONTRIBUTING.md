# Contributing to Rocket.Chat MCP Server Generator

Thanks for helping improve the Rocket.Chat MCP Server Generator. This project is a TypeScript MCP server that discovers Rocket.Chat REST APIs, exposes schema inspection tools, and generates focused workflow-driven MCP servers.

## Prerequisites

- Node.js 22 or newer
- npm
- Git

## Getting Started

Clone the repository and install dependencies:

```bash
git clone https://github.com/RocketChat/MCPServerGenerator_GSoC2026.git
cd MCPServerGenerator_GSoC2026
npm install
```

Run the local validation checks:

```bash
npm run typecheck
npm run test:unit
npm run build
```

## Development Workflow

Use the development entry point while iterating locally:

```bash
npm run dev
```

Use the compiled entry point after a build:

```bash
npm start
```

Before opening a pull request, run the full project check when your environment can support all tests:

```bash
npm run check
```

## Code Quality

This repository uses TypeScript, ESLint, Prettier, and Node's built-in test runner. Keep changes focused and run the relevant checks before submitting work:

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run build
```

Use `npm run format` only when you intentionally want Prettier to rewrite files.
