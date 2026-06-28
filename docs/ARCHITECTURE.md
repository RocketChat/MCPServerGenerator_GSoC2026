# MCP Server Generator — Architecture & High-Level Design

> This is the authoritative high-level design of the project. It describes the architecture and every module — what each one is responsible for and how they fit together. It deliberately does not explain code, algorithms, or implementation details.

---

## 1. What the System Is

This project is a **meta-MCP-server**: an MCP server whose purpose is to **generate other MCP servers**. Instead of exposing business tools (like "send a message"), it exposes tools that let an AI assistant **describe a workflow in a small DSL and receive a complete, runnable MCP server project** in return.

It is driven as an MCP server — an AI client (Gemini CLI, Claude Desktop, VS Code Copilot) connects over stdio and calls three tools to discover an API, inspect schemas, and generate a project.

```mermaid
mindmap
  root((MCP Server<br/>Generator))
    Purpose
      Generate MCP servers from a DSL
      Chain API calls + AI + human steps
      Output a runnable TypeScript project
    Entry Points
      MCP server over stdio
    Pipeline
      Parse DSL
      Compose and validate workflow
      Generate code
    Runtime
      Workflow engine copied into output
      api_call sampling elicitation transform conditional
```

---

## 2. System Context

The generator sits between an **author** (an AI client) and the **generated artifact** (a project on disk). It reads API knowledge from an **OpenAPI source**.

```mermaid
flowchart LR
    subgraph Authors
        AI[AI Client<br/>Gemini / Claude / Copilot]
    end

    subgraph Generator[MCP Server Generator]
        TOOLS[Three MCP Tools]
        CORE[Core Pipeline]
    end

    SPEC[(OpenAPI Specs<br/>Rocket.Chat)]
    OUT[(Generated Project<br/>on disk)]

    AI -->|stdio JSON-RPC| TOOLS
    TOOLS --> CORE
    CORE -->|fetch & parse| SPEC
    CORE -->|write files| OUT
    OUT -->|runs as its own| AInew[New MCP Server]
```

---

## 3. The Three-Tool Contract

When used as an MCP server, the whole experience is three tools called in sequence:

```mermaid
sequenceDiagram
    participant AI as AI Client
    participant G as Generator (MCP)
    participant S as OpenAPI Source

    AI->>G: 1. get_capability_guide
    G->>S: fetch & parse all domains
    S-->>G: endpoints
    G-->>AI: compact guide (summaries -> operationIds)

    AI->>G: 2. get_endpoint_schemas([operationIds])
    G->>S: fetch chosen domains
    S-->>G: full schemas
    G-->>AI: request/response schemas (+ auto-corrected ids)

    Note over AI: AI writes DSL using the schemas

    AI->>G: 3. generate(dsl)
    G->>G: parse -> compose -> generate -> write
    G-->>AI: success + project location
```

| Tool | Responsibility | Backed by module |
|------|----------------|------------------|
| `get_capability_guide` | Discovery: list every endpoint as `summary -> operationId` | `tools/get-capability-guide.ts` |
| `get_endpoint_schemas` | Detail: return exact request/response schemas for chosen ids | `tools/get-endpoint-schemas.ts` |
| `generate` | Build a full MCP server project from a DSL string | `tools/generate.ts` |

---

## 4. Module Map

The source is organized into focused modules under `src/`:

```mermaid
flowchart TB
    subgraph Entry[Entry Layer]
        IDX[index.ts<br/>stdio bootstrap]
        SRV[server.ts<br/>MCP server + tool registration]
    end

    subgraph ToolLayer[Tool Layer - src/tools]
        T1[get-capability-guide]
        T2[get-endpoint-schemas]
        T3[generate]
    end

    subgraph Core[Core Pipeline]
        DSL[src/dsl<br/>DSL parser]
        COMP[src/composer<br/>workflow composer]
        GEN[src/generator<br/>code generator]
    end

    subgraph Support[Supporting Modules]
        PARSE[src/parser<br/>OpenAPI parser]
        WF[src/workflow<br/>runtime engine]
        UTIL[src/utils<br/>operationId resolver]
    end

    IDX --> SRV
    SRV --> T1 & T2 & T3
    T1 --> PARSE
    T2 --> PARSE
    T3 --> DSL --> COMP --> GEN
    T3 --> PARSE
    GEN --> WF
    COMP --> WF
```

---

## 5. Module Overviews

### 5.1 Entry Layer

- **`index.ts`** — Process bootstrap. Creates the MCP server and connects it over a stdio transport.
- **`server.ts`** — Builds the `McpServer`, registers the three tools with their descriptions and schemas. This is the composition root.

### 5.2 Tool Layer — `src/tools`

The request handlers for each MCP tool. They orchestrate the core modules and shape the responses returned to the AI.

- **`get-capability-guide.ts`** — Handler for discovery. Asks the parser for all endpoints and formats them into a guide.
- **`get-endpoint-schemas.ts`** — Handler that returns exact request/response schemas for the operationIds the AI selected.
- **`generate.ts`** — The orchestrator for project generation. Drives parse -> compose -> generate.

### 5.3 DSL Module — `src/dsl`

Turns the author's DSL text into a structured, in-memory representation. This is the "front-end" of the compiler analogy.

- **`scanner.ts`** — Lexical pass over raw DSL text (line handling, comments, heredoc blocks).
- **`parser.ts`** — A recursive descent parser that builds projects, workflows, params, and steps.
- **`types.ts`** — DSL-level types (`DslWorkflow`, `DslStep`, `ParseDslResult`).
- **`index.ts`** — Public surface (`parseDsl`, types).

```mermaid
stateDiagram-v2
    [*] --> ROOT
    ROOT --> ROOT: PROJECT / DESCRIPTION
    ROOT --> WORKFLOW: WORKFLOW
    WORKFLOW --> WORKFLOW: DESCRIPTION / PARAM
    WORKFLOW --> STEP: STEP
    STEP --> STEP: MAP / OPERATION / DEPENDS ON ...
    STEP --> WORKFLOW: next WORKFLOW
    WORKFLOW --> [*]
    STEP --> [*]
```

### 5.4 Composer Module — `src/composer`

The "middle-end" — semantic analysis, normalization, validation, and ordering. It takes raw parsed steps and produces a fully validated, dependency-ordered `WorkflowDefinition`.

| File | Responsibility |
|------|----------------|
| `composer.ts` | Orchestrates the full validation/normalization pipeline |
| `dsl-mapping.ts` | Adapts raw DSL workflow objects into the composer's input shape |
| `validation.ts` | Structural checks: unique ids, required fields, reference integrity, cycles |
| `normalization.ts` | Auto-fixes common authoring mistakes (template syntax, escaping) |
| `inference.ts` | Fills in omitted information (conditional targets, implicit dependencies) |
| `warnings.ts` | Emits non-fatal quality warnings (unused steps, orphans, deep chains) |
| `types.ts` | Composer-level input/output and warning types |

```mermaid
flowchart LR
    IN[raw parsed steps] --> N[normalize]
    N --> I[infer missing pieces]
    I --> V[validate]
    V --> W[generate warnings]
    W --> S[topological sort]
    S --> OUT[WorkflowDefinition<br/>ordered + validated]
```

### 5.5 Generator Module — `src/generator`

The "back-end" — turns a validated `WorkflowDefinition` plus endpoint info into a complete set of project files.

| File | Responsibility |
|------|----------------|
| `pipeline.ts` | Full pipeline: DSL -> parsed -> composed -> generated project |
| `project.ts` | Assembles the complete file set for a project |
| `codegen.ts` | Generates per-workflow tool files, endpoint maps, server entry |
| `scaffold.ts` | Static/templated files: REST client, package.json, tsconfig, README |
| `engine-bundle.ts` | Copies the workflow engine into the output |
| `dsl-mapping.ts` | Maps DSL structures to generator input |
| `types.ts` | Generator-level types |

```mermaid
flowchart TB
    WD[WorkflowDefinition] --> SC[codegen]
    WD --> TM[scaffold]
    SC & TM --> FM[file map]
    FM --> PL[project.generateProject]
    PL --> ENG[bundle engine]
    PL --> DISK[(project on disk)]
```

### 5.6 OpenAPI Parser Module — `src/parser`

Reads API knowledge from OpenAPI specs and exposes it to the tools.

| File | Responsibility |
|------|----------------|
| `spec-source.ts` | Fetches and caches OpenAPI documents (in-memory / disk / remote) |
| `spec-parser.ts` | Implements `SpecParser`: lists endpoints and returns full endpoint details |
| `endpoint-extraction.ts` | Extracts compact and full endpoint records from a parsed spec |
| `schema-mapper.ts` | Converts OpenAPI schemas into JSON-Schema-style shapes |
| `types.ts` | Domain, endpoint, and parser interface types |
| `index.ts` | Public surface |

```mermaid
flowchart LR
    REQ[tool request] --> SP[SpecParser]
    SP --> SS[spec-source<br/>3-tier cache]
    SS -->|miss| NET[(remote spec)]
    SS -->|hit| MEM[(memory / disk)]
    SP --> EX[endpoint-extraction]
    EX --> SM[schema-mapper]
    SM --> RES[endpoints + schemas]
```

### 5.7 Workflow Module — `src/workflow`

The runtime engine. These files are **copied verbatim into every generated project** — they are both part of this repo and the runtime of the output.

| File | Responsibility |
|------|----------------|
| `executor.ts` | The execution loop: step scheduling, branching, error handling |
| `api-call.ts` | Executes `api_call` steps (payload, request, response parsing) |
| `sampling.ts` | Executes `sampling` (LLM) steps |
| `templates.ts` | Evaluates template expressions and resolves `{{...}}` placeholders |
| `expression-security.ts` | Guards expressions against dangerous patterns (AST allowlist) |
| `types.ts` | `WorkflowDefinition` / step types shared with codegen |

```mermaid
flowchart TB
    RW[runWorkflow] --> SCH{find ready steps}
    SCH --> TYPE{step type}
    TYPE -->|api_call| API[api-call]
    TYPE -->|sampling| SMP[sampling]
    TYPE -->|transform| EXP[templates]
    TYPE -->|conditional| CON[branch select]
    TYPE -->|elicitation| ELI[ask user]
    API & SMP & EXP & CON & ELI --> ST[update state]
    ST --> SCH
    ST --> DONE[result: status + stepResults]
```

---

## 6. End-to-End Data Flow

The full journey from a DSL string to a project on disk:

```mermaid
flowchart TB
    START([DSL input]) --> PARSE[dsl.parseDsl]
    PARSE --> MAP[dslWorkflowToComposeInput]
    MAP --> COMPOSE[composeWorkflowDefinition]
    COMPOSE --> EP[collect required endpoints]
    EP --> RES[derive method + path from operationId]
    RES --> BUILD[generator.generateProject]
    BUILD --> COPY[bundle workflow engine]
    COPY --> END([runnable MCP server project])
```

---

## 7. Pipeline-as-Compiler Analogy

The architecture mirrors a classic compiler:

```mermaid
flowchart LR
    subgraph FrontEnd[Front-end]
        L[DSL Scanner<br/>lexing]
        P[DSL Parser<br/>parsing -> AST]
    end
    subgraph MiddleEnd[Middle-end]
        C[Composer<br/>validate / normalize / infer / order]
    end
    subgraph BackEnd[Back-end]
        G[Generator<br/>emit project files]
    end
    subgraph Runtime[Runtime]
        E[Workflow Engine<br/>executes in output project]
    end
    L --> P --> C --> G --> E
```

---

## 8. Generated Project — Output View

What the system produces:

```mermaid
flowchart TB
    subgraph Project[Generated MCP Server]
        SRV2[src/server.ts<br/>MCP entry - stdio]
        CLIENT2[src/rc-client.ts<br/>REST API client]
        TOOLS2[src/tools/*.ts<br/>one file per workflow]
        ENGINE2[src/engine/*<br/>copied workflow engine]
        META[package.json / tsconfig.json<br/>.env.example / README.md]
    end
    SRV2 --> TOOLS2 --> ENGINE2 --> CLIENT2
```

The generated server runs independently: an AI client calls a workflow tool, the engine executes its steps in topological order, and results flow back.

---

## 9. Step Types

The five workflow step types the engine understands:

```mermaid
flowchart LR
    A[api_call<br/>calls a REST endpoint]
    S[sampling<br/>LLM reasoning]
    E[elicitation<br/>ask the human]
    T[transform<br/>reshape data via expression]
    C[conditional<br/>branch on a boolean]
```

| Type | Purpose | Required fields | Output |
|------|---------|-----------------|--------|
| `api_call` | Call a REST endpoint | `operationId` | Parsed response |
| `sampling` | LLM reasoning/analysis | `prompt` | Text or JSON |
| `elicitation` | Ask the user, wait for input | `message`, `requestedSchema` | User response |
| `transform` | Reshape data | `expression` | Expression result |
| `conditional` | Branch execution | `condition`, `thenStep` | Boolean |

---

## 10. Module Responsibility Summary

| Module | Layer | One-line responsibility |
|--------|-------|-------------------------|
| `src/index.ts` | Entry | Boot the MCP server over stdio |
| `src/server.ts` | Entry | Register the three MCP tools (composition root) |
| `src/tools` | Tool | Request handlers for discovery, schemas, generation |
| `src/dsl` | Core | Parse DSL text into structured workflows |
| `src/composer` | Core | Validate, normalize, infer, and order workflows |
| `src/generator` | Core | Generate and write all project files |
| `src/parser` | Support | Fetch/parse OpenAPI specs; expose endpoints + schemas |
| `src/workflow` | Support | Runtime engine (copied into output) |
| `src/utils` | Support | operationId reconciliation |
