# DSL Reference

> The complete specification of the workflow DSL consumed by the `generate` tool. This is the user-facing contract: the AI (or a developer) writes DSL text, and the generator turns it into a runnable MCP server.

---

## 1. Overview

The DSL is **flat and line-oriented**: every meaningful line is `KEYWORD value`. There is no significant indentation (indentation is cosmetic and trimmed). A document declares one **project**, which contains one or more **workflows**, each containing one or more **steps**. Each workflow becomes one MCP tool; each step is one unit of work (an API call, an LLM call, a user prompt, a data transform, or a branch).

```
PROJECT <name>
DESCRIPTION <text>

WORKFLOW <name>
  DESCRIPTION <text>
  PARAM <name> : <type> [: <description>]
  STEP <id> : <type>
    <step keywords...>
```

Design goal: be robust against the ways an LLM mangles structured formats. Keywords are uppercase, values are free-form, and the parser auto-corrects or rejects common mistakes with line-numbered errors.

---

## 2. Grammar (EBNF-style)

```ebnf
document        = project_decl , project_desc , { workflow } ;

project_decl    = "PROJECT" , WS , name , NL ;
project_desc    = "DESCRIPTION" , WS , text , NL ;

workflow        = "WORKFLOW" , WS , name , NL ,
                  { workflow_desc | param | step } ;
workflow_desc   = "DESCRIPTION" , WS , text , NL ;
param           = "PARAM" , WS , name , ":" , param_type , [ ":" , text ] , NL ;

step            = "STEP" , WS , id , ":" , step_type , NL ,
                  { step_field } ;

step_field      = label | depends | operation | output_path | for_each | as
                | map | expression | condition | then | else
                | prompt | system_prompt | max_tokens | response_format
                | message | schema | on_decline | continue_on_error ;

heredoc         = WS , "<<<" , NL , { any_line , NL } , ">>>" , NL ;

param_type      = "string" | "number" | "boolean" | "object" | "array" ;
step_type       = "api_call" | "sampling" | "elicitation" | "transform" | "conditional" ;
comment         = "#" , text , NL ;
```

---

## 3. Lexical Rules

### 3.1 Lines & whitespace
- Line endings are normalized to `\n` before parsing.
- Leading/trailing whitespace on a line is trimmed. Indentation carries no meaning.

### 3.2 Comments
Only lines whose first non-whitespace character is `#` are comments.

```
# This whole line is a comment
MAP channel = #workspace-admin    <- NOT a comment; "#workspace-admin" is the value
```

### 3.3 Required document structure
A valid document must have:
1. exactly one `PROJECT <name>` (must be first meaningful line),
2. a project-level `DESCRIPTION`,
3. at least one `WORKFLOW`.

---

## 4. Project Level

| Keyword | Form | Rules |
| --- | --- | --- |
| `PROJECT` | `PROJECT <name>` | First line. Name becomes the output directory. |
| `DESCRIPTION` | `DESCRIPTION <text>` | Only recognized as project-level before the first `WORKFLOW`. |

---

## 5. Workflow Level

```
WORKFLOW <name>
  DESCRIPTION <text>
  PARAM <name> : <type> [: <description>]
  ...
  STEP ...
```

- **`WORKFLOW <name>`** — starts a workflow. The name should be snake_case (becomes the MCP tool name).
- **`DESCRIPTION <text>`** — the tool description. Required.
- **`PARAM <name> : <type> [: <description>]`** — declares an input parameter.

### 5.1 PARAM types

| Type | JSON Schema type |
| --- | --- |
| `string` | `string` |
| `number` | `number` |
| `boolean` | `boolean` |
| `object` | `object` |
| `array` | `array` |

Parameters are referenced in steps via `{{params.<name>}}`.

---

## 6. Step Level

```
STEP <id> : <type>
  <keywords...>
```

- **`<id>`** must be unique within the workflow.
- **`<type>`** is one of the five step types.

### 6.1 Step types and required fields

| Type | Purpose | Required | Output at runtime |
| --- | --- | --- | --- |
| `api_call` | Call a REST endpoint | `OPERATION` | parsed API response |
| `sampling` | LLM reasoning/analysis | `PROMPT` | text string or parsed JSON |
| `elicitation` | Ask the user, wait for response | `MESSAGE` | user's response |
| `transform` | Reshape data via JS | `EXPRESSION` | whatever the expression returns |
| `conditional` | Branch execution | `CONDITION` + (`THEN` or `ELSE`) | boolean |

### 6.2 Step keyword reference

| Keyword | Applies to | Value | Notes |
| --- | --- | --- | --- |
| `LABEL` | all | text | Human label |
| `DEPENDS ON` | all | space-separated ids | Explicit ordering (usually inferred) |
| `OPERATION` | api_call | operationId | The REST endpoint to call |
| `OUTPUT_PATH` | api_call | dot path | Extract a sub-field of the response |
| `FOR_EACH` | api_call | collection expression | Iterate over items |
| `AS` | api_call | identifier | Names the loop variable |
| `MAP` | api_call | `path = value` | Builds the request payload |
| `EXPRESSION` | transform | JS (inline/heredoc) | The transform body |
| `CONDITION` | conditional | JS boolean (inline/heredoc) | The branch test |
| `THEN` / `ELSE` | conditional | step id | Branch targets |
| `PROMPT` | sampling | text (inline/heredoc) | The user prompt |
| `SYSTEM_PROMPT` | sampling | text (inline/heredoc) | System instructions |
| `MAX_TOKENS` | sampling | integer | Output cap |
| `RESPONSE_FORMAT` | sampling | token | e.g. `json` to force JSON parsing |
| `MESSAGE` | elicitation | text (inline/heredoc) | The question shown to the user |
| `SCHEMA` | elicitation | JSON (inline/heredoc) | Expected shape of the response |
| `ON_DECLINE` | elicitation | `abort` or `skip_remaining` | What to do if user declines |
| `CONTINUE_ON_ERROR` | api_call | (flag) | Don't fail if this step errors |

---

## 7. MAP: Dot-paths, Auto-typing, Merging

### 7.1 Dot-paths
`MAP a.b.c = value` produces nested objects: `{ a: { b: { c: value } } }`.

### 7.2 Merging
Multiple MAPs to the same step deep-merge:

```
MAP message.rid = {{params.room_id}}
MAP message.msg = Hello
```
produces `{ "message": { "rid": "{{params.room_id}}", "msg": "Hello" } }`

### 7.3 Value auto-typing

| Input | Result |
| --- | --- |
| `true` / `false` | boolean |
| `42`, `-3.14` | number |
| `{ ... }` / `[ ... ]` (valid JSON) | parsed object/array |
| anything else | string |

Templates (`{{...}}`) are never coerced — they stay as strings.

### 7.4 MAP forbids heredoc
`MAP x = <<<` throws an error. Use a transform step for complex values.

---

## 8. Heredocs (Multi-line Values)

Keywords that hold multi-line content support heredoc syntax: put `<<<` after the keyword, then content lines, then a line that is exactly `>>>`.

Heredoc-capable keywords: `EXPRESSION`, `CONDITION`, `PROMPT`, `SYSTEM_PROMPT`, `MESSAGE`, `SCHEMA`.

```
STEP categorize : transform
  EXPRESSION <<<
    const channels = steps.get_channels || [];
    const cutoff = Date.now() - params.days_inactive * 86400000;
    return channels.filter(ch => new Date(ch.lm).getTime() < cutoff);
  >>>
```

Rules:
- Content between `<<<` and `>>>` is captured verbatim (newlines preserved).
- Triple-brace normalization: `{{{expr}}}` is collapsed to `{{expr}}`.
- An empty value throws.
- Reaching end-of-file before `>>>` throws `Unterminated heredoc (missing >>>)`.
- `SCHEMA` heredocs must contain valid JSON.

---

## 9. Template Expressions & Data Flow

Steps pass data via `{{...}}` templates. Two reference roots:

- `{{params.<name>}}` — a workflow parameter.
- `{{steps.<id>}}` — the result of a prior step (sub-fields: `{{steps.fetch.channels}}`).

For `forEach`, the loop variable is referenced as `{{<as>.field}}`.

The composer validates every reference and **auto-adds dependencies** when a step references another via `{{steps.X}}`.

`transform` and `conditional` bodies are raw JavaScript — inside them you use `steps.x`, `params.y` directly (no braces).

---

## 10. Complete Examples

### 10.1 Minimal — single API call

```
PROJECT hello-bot
DESCRIPTION Posts a greeting to a channel

WORKFLOW post_greeting
  DESCRIPTION Send a greeting message
  PARAM channel : string : Target channel name
  PARAM text : string : Message text

  STEP send : api_call
    LABEL Send message
    OPERATION post-api-v1-chat_postMessage
    MAP channel = {{params.channel}}
    MAP text = {{params.text}}
```

### 10.2 Multi-step — fetch, AI analysis, branch, act

```
PROJECT channel-janitor
DESCRIPTION Archives channels inactive for N days, with AI triage

WORKFLOW cleanup_channels
  DESCRIPTION Find inactive channels, ask AI which are safe to archive, archive them
  PARAM days_inactive : number : Days of inactivity threshold

  STEP get_channels : api_call
    LABEL Fetch channels
    OPERATION get-api-v1-channels_list
    MAP count = 100
    OUTPUT_PATH channels

  STEP triage : sampling
    LABEL AI triage
    RESPONSE_FORMAT json
    SYSTEM_PROMPT Respond ONLY with JSON.
    PROMPT <<<
      Given these channels: {{steps.get_channels}}
      Return JSON: { "safe": [names], "risky": [names] }
    >>>

  STEP has_safe : conditional
    LABEL Any safe to archive?
    CONDITION steps.triage.safe.length > 0
    THEN archive

  STEP archive : api_call
    LABEL Archive safe channels
    OPERATION post-api-v1-channels_archive
    FOR_EACH {{steps.triage.safe}}
    AS name
    MAP roomId = {{name}}
    CONTINUE_ON_ERROR
```

### 10.3 Human-in-the-loop — elicitation

```
PROJECT broadcast
DESCRIPTION Drafts an announcement, confirms with the user, then posts it

WORKFLOW announce
  DESCRIPTION Compose, confirm, broadcast
  PARAM topic : string : What to announce

  STEP draft : sampling
    LABEL Draft announcement
    PROMPT Write a short announcement about: {{params.topic}}

  STEP confirm : elicitation
    LABEL Confirm before sending
    MESSAGE Send this announcement? {{steps.draft}}
    SCHEMA {"type":"object","properties":{"approved":{"type":"boolean"}}}
    ON_DECLINE abort

  STEP post : api_call
    LABEL Post to #announcements
    OPERATION post-api-v1-chat_postMessage
    MAP channel = #announcements
    MAP text = {{steps.draft}}
```

---

## 11. Parse-time Error Catalog

| Error message | Cause |
| --- | --- |
| `Missing PROJECT declaration` | no `PROJECT` line |
| `Missing project DESCRIPTION` | no project-level `DESCRIPTION` |
| `No WORKFLOW declarations found` | zero workflows |
| `STEP requires format "STEP id : type"` | malformed step header |
| `Unknown step type "X"` | type not in the five valid types |
| `PARAM type "X" invalid` | bad param type |
| `Duplicate step ID "X"` / `Duplicate PARAM "X"` | name collisions |
| `MAP requires format "MAP path = value"` | missing `=` |
| `MAP does not support heredoc (<<<)` | heredoc used with MAP |
| `Unterminated heredoc (missing >>>)` | EOF inside a heredoc |
| `Invalid JSON in SCHEMA` | bad SCHEMA JSON |
| `Unknown keyword "X" in step "Y"` | unrecognized keyword |
| `Step "X" (type) requires <FIELD>` | missing required field |
| `Step "X" has FOR_EACH without AS` | unpaired iteration keywords |

Every error is prefixed `Line N:` for easy navigation.
