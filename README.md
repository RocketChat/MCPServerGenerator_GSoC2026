# Rocket.Chat MCP Server Generator

A tool that generates minimal MCP servers for Rocket.Chat — covering only the subset of APIs a project actually needs, instead of bundling every endpoint. This cuts down the context bloat that makes MCP expensive in agentic workflows, and can bring Rocket.Chat code generation projects within the free tier of most LLM platform providers.

## Current Status

Implemented:

- Parses Rocket.Chat OpenAPI specs by domain
- Lists compact endpoint capability guides
- Returns request and response schemas for selected operationIds
- Uses memory and disk cache for specs
- Includes unit and integration tests

## Building & Testing

```bash
npm install
npm test
npm run build
```
