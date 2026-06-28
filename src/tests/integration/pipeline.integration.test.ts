/**
 * End-to-end integration tests for the full pipeline: DSL string -> generated project.
 *
 * Verifies that:
 * 1. The DSL parser produces valid structures
 * 2. The composer validates and transforms workflows
 * 3. The code generator produces valid TypeScript files
 * 4. The generated project structure is complete
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { composeDsl, generateFromDsl } from "../../generator/pipeline.js";
import { generateProject } from "../../generator/project.js";
import type { GeneratorEndpoint } from "../../generator/types.js";

const MINIMAL_DSL = `
PROJECT test-bot
DESCRIPTION A minimal test bot

WORKFLOW send_greeting
  DESCRIPTION Sends a greeting message to a channel
  PARAM channel_name : string : The channel to greet
  PARAM message : string : The greeting message

  STEP post_message : api_call
    LABEL Post greeting message
    OPERATION post-api-v1-chat_postMessage
    MAP channel = {{params.channel_name}}
    MAP text = {{params.message}}
`;

const MULTI_WORKFLOW_DSL = `
PROJECT onboarding-bot
DESCRIPTION Automates user onboarding workflows

WORKFLOW create_onboarding_channel
  DESCRIPTION Creates a private onboarding channel for a new user
  PARAM username : string : The new user's username
  PARAM channel_name : string : Name for the onboarding channel

  STEP create_channel : api_call
    LABEL Create onboarding channel
    OPERATION post-api-v1-channels_create
    MAP name = {{params.channel_name}}

  STEP invite_user : api_call
    LABEL Invite user to channel
    DEPENDS ON create_channel
    OPERATION post-api-v1-channels_invite
    MAP roomId = {{steps.create_channel.channel._id}}
    MAP userId = {{params.username}}

  STEP send_welcome : api_call
    LABEL Send welcome message
    DEPENDS ON invite_user
    OPERATION post-api-v1-chat_postMessage
    MAP channel = {{params.channel_name}}
    MAP text = Welcome aboard!

WORKFLOW analyze_sentiment
  DESCRIPTION Analyzes message sentiment using AI
  PARAM room_id : string : Room to analyze
  PARAM count : number : Number of messages to analyze

  STEP fetch_messages : api_call
    LABEL Fetch recent messages
    OPERATION get-api-v1-channels_history
    MAP roomId = {{params.room_id}}
    MAP count = {{params.count}}

  STEP analyze : sampling
    LABEL Analyze sentiment
    DEPENDS ON fetch_messages
    PROMPT <<<
Analyze the sentiment of these messages and provide a summary.
Messages: {{steps.fetch_messages}}
Respond with a JSON object containing: overall_sentiment, positive_count, negative_count.
>>>
    SYSTEM_PROMPT You are a sentiment analysis expert. Always respond in JSON.
    MAX_TOKENS 500
`;

const TRANSFORM_DSL = `
PROJECT data-pipeline
DESCRIPTION Data transformation workflows

WORKFLOW extract_users
  DESCRIPTION Extracts and transforms user data
  PARAM department : string : Department to filter

  STEP get_users : api_call
    LABEL Get all users
    OPERATION get-api-v1-users_list

  STEP filter_dept : transform
    LABEL Filter by department
    DEPENDS ON get_users
    EXPRESSION <<<
const users = steps.get_users || [];
return users.filter(u => u.department === params.department);
>>>

  STEP format_report : transform
    LABEL Format the report
    DEPENDS ON filter_dept
    EXPRESSION <<<
const filtered = steps.filter_dept;
return { department: params.department, count: filtered.length, users: filtered.map(u => u.username) };
>>>
`;

const CONDITIONAL_DSL = `
PROJECT moderation-bot
DESCRIPTION Automated content moderation

WORKFLOW moderate_message
  DESCRIPTION Checks and moderates a message
  PARAM room_id : string : The room ID
  PARAM message_id : string : The message ID

  STEP fetch_msg : api_call
    LABEL Fetch the message
    OPERATION get-api-v1-chat_getMessage
    MAP msgId = {{params.message_id}}

  STEP check_content : sampling
    LABEL Check for violations
    DEPENDS ON fetch_msg
    PROMPT <<<
Check if this message violates community guidelines:
{{steps.fetch_msg}}
Respond with JSON: { "violation": true/false, "reason": "..." }
>>>
    SYSTEM_PROMPT You are a content moderator. Respond only with JSON.
    RESPONSE_FORMAT json

  STEP is_violation : conditional
    LABEL Check if violation found
    DEPENDS ON check_content
    CONDITION steps.check_content.violation === true
    THEN delete_msg
    ELSE log_clean

  STEP delete_msg : api_call
    LABEL Delete the message
    DEPENDS ON is_violation
    OPERATION post-api-v1-chat_delete
    MAP roomId = {{params.room_id}}
    MAP msgId = {{params.message_id}}

  STEP log_clean : transform
    LABEL Log clean result
    DEPENDS ON is_violation
    EXPRESSION ({ status: "clean", messageId: params.message_id })
`;

describe("composeDsl — parse and compose pipeline", () => {
  it("parses and composes a minimal workflow", () => {
    const result = composeDsl(MINIMAL_DSL);
    assert.equal(result.projectName, "test-bot");
    assert.equal(result.workflows.length, 1);
    assert.equal(result.workflows[0].name, "send_greeting");
  });

  it("parses and composes multiple workflows", () => {
    const result = composeDsl(MULTI_WORKFLOW_DSL);
    assert.equal(result.projectName, "onboarding-bot");
    assert.equal(result.workflows.length, 2);
    const names = result.workflows.map((w) => w.name);
    assert.ok(names.includes("create_onboarding_channel"));
    assert.ok(names.includes("analyze_sentiment"));
  });

  it("composes transform workflows", () => {
    const result = composeDsl(TRANSFORM_DSL);
    assert.equal(result.workflows.length, 1);
    const wf = result.workflows[0];
    assert.equal(wf.name, "extract_users");
    assert.equal(wf.steps.length, 3);
  });

  it("composes conditional workflows", () => {
    const result = composeDsl(CONDITIONAL_DSL);
    const wf = result.workflows[0];
    const condStep = wf.steps.find(
      (s) => s.config.type === "conditional",
    );
    assert.ok(condStep, "Should have a conditional step");
    assert.equal(condStep!.id, "is_violation");
  });

  it("detects sampling capability", () => {
    const result = composeDsl(MULTI_WORKFLOW_DSL);
    const samplingWf = result.workflows.find(
      (w) => w.name === "analyze_sentiment",
    )!;
    assert.ok(samplingWf.usesSampling);
  });

  it("throws on invalid DSL", () => {
    assert.throws(() => composeDsl("INVALID_KEYWORD something"));
  });

  it("throws on missing workflow", () => {
    assert.throws(
      () => composeDsl("PROJECT x\nDESCRIPTION y\n"),
      /No WORKFLOW/,
    );
  });
});

describe("generateFromDsl — full generation pipeline", () => {
  const endpoints: GeneratorEndpoint[] = [
    {
      operationId: "post-api-v1-chat_postMessage",
      method: "POST",
      path: "/api/v1/chat.postMessage",
    },
  ];

  it("generates a project from minimal DSL", () => {
    const result = generateFromDsl(MINIMAL_DSL, { endpoints });
    assert.equal(result.files.length > 0, true);
    assert.equal(result.summary.serverName, "test_bot");
    assert.equal(result.summary.workflowCount, 1);
  });

  it("generates workflow tool file", () => {
    const result = generateFromDsl(MINIMAL_DSL, { endpoints });
    const toolFile = result.files.find(
      (f) => f.path === "src/tools/send_greeting.ts",
    );
    assert.ok(toolFile, "Missing workflow tool file");
    assert.ok(toolFile!.content.includes("send_greeting"));
  });
});

describe("generateProject — file structure completeness", () => {
  const composed = composeDsl(MULTI_WORKFLOW_DSL);
  const endpoints: GeneratorEndpoint[] = [
    { operationId: "post-api-v1-channels_create", method: "POST", path: "/api/v1/channels.create" },
    { operationId: "post-api-v1-channels_invite", method: "POST", path: "/api/v1/channels.invite" },
    { operationId: "post-api-v1-chat_postMessage", method: "POST", path: "/api/v1/chat.postMessage" },
    { operationId: "get-api-v1-channels_history", method: "GET", path: "/api/v1/channels.history" },
  ];

  const result = generateProject({
    serverName: composed.projectName,
    workflows: composed.workflows,
    endpoints,
  });

  it("generates all required files", () => {
    const paths = result.files.map((f) => f.path);
    assert.ok(paths.includes("src/server.ts"), "Missing server.ts");
    assert.ok(paths.includes("src/rc-client.ts"), "Missing rc-client.ts");
    assert.ok(paths.includes("package.json"), "Missing package.json");
    assert.ok(paths.includes("tsconfig.json"), "Missing tsconfig.json");
    assert.ok(paths.includes(".env.example"), "Missing .env.example");
    assert.ok(paths.includes(".gitignore"), "Missing .gitignore");
    assert.ok(paths.includes("README.md"), "Missing README.md");
  });

  it("generates tool files for both workflows", () => {
    const paths = result.files.map((f) => f.path);
    assert.ok(paths.includes("src/tools/create_onboarding_channel.ts"));
    assert.ok(paths.includes("src/tools/analyze_sentiment.ts"));
  });

  it("server entry imports both workflows", () => {
    const serverFile = result.files.find((f) => f.path === "src/server.ts");
    assert.ok(serverFile);
    assert.ok(serverFile!.content.includes("create_onboarding_channel"));
    assert.ok(serverFile!.content.includes("analyze_sentiment"));
  });

  it("package.json is valid JSON with correct fields", () => {
    const pkgFile = result.files.find((f) => f.path === "package.json");
    assert.ok(pkgFile);
    const pkg = JSON.parse(pkgFile!.content);
    assert.equal(pkg.type, "module");
    assert.ok(pkg.dependencies["@modelcontextprotocol/sdk"]);
    assert.ok(pkg.dependencies["zod"]);
    assert.ok(pkg.scripts.start);
    assert.ok(pkg.scripts.build);
  });

  it("tsconfig.json is valid JSON with ESM settings", () => {
    const tsFile = result.files.find((f) => f.path === "tsconfig.json");
    assert.ok(tsFile);
    const config = JSON.parse(tsFile!.content);
    assert.ok(config.compilerOptions.strict);
    assert.equal(config.compilerOptions.module, "Node16");
  });

  it("endpoint map includes all required endpoints", () => {
    const epFile = result.files.find((f) => f.path === "src/endpoints.ts");
    assert.ok(epFile);
    assert.ok(epFile!.content.includes("post-api-v1-channels_create"));
    assert.ok(epFile!.content.includes("post-api-v1-chat_postMessage"));
    assert.ok(epFile!.content.includes("get-api-v1-channels_history"));
  });

  it("server.ts has valid import structure", () => {
    const serverFile = result.files.find((f) => f.path === "src/server.ts");
    assert.ok(serverFile);
    const code = serverFile!.content;
    assert.ok(code.includes("import { McpServer }") || code.includes("McpServer"));
    assert.ok(code.includes("StdioServerTransport"));
  });

  it("workflow tool code references the workflow engine", () => {
    const toolFile = result.files.find(
      (f) => f.path === "src/tools/create_onboarding_channel.ts",
    );
    assert.ok(toolFile);
    assert.ok(toolFile!.content.includes("runWorkflow"));
  });

  it("README includes project documentation", () => {
    const readme = result.files.find((f) => f.path === "README.md");
    assert.ok(readme);
    assert.ok(readme!.content.includes("onboarding"));
    assert.ok(readme!.content.includes("npm install"));
  });

  it("reports correct summary", () => {
    assert.equal(result.summary.workflowCount, 2);
    assert.equal(result.summary.endpointCount, 4);
    assert.ok(result.summary.usesSampling);
  });
});

describe("generateProject — error handling", () => {
  it("throws on empty workflows array", () => {
    assert.throws(
      () =>
        generateProject({
          serverName: "test",
          workflows: [],
          endpoints: [],
        }),
      /no workflows/i,
    );
  });
});

describe("generateProject — generated TypeScript validity", () => {
  const composed = composeDsl(MINIMAL_DSL);
  const endpoints: GeneratorEndpoint[] = [
    { operationId: "post-api-v1-chat_postMessage", method: "POST", path: "/api/v1/chat.postMessage" },
  ];

  const result = generateProject({
    serverName: composed.projectName,
    workflows: composed.workflows,
    endpoints,
  });

  it("server.ts has valid async main structure", () => {
    const serverFile = result.files.find((f) => f.path === "src/server.ts");
    assert.ok(serverFile);
    const code = serverFile!.content;
    assert.ok(code.includes("async function main()") || code.includes("async"));
    assert.ok(code.includes("connect"));
  });

  it("tool file has export structure", () => {
    const toolFile = result.files.find(
      (f) => f.path === "src/tools/send_greeting.ts",
    );
    assert.ok(toolFile);
    const code = toolFile!.content;
    assert.ok(code.includes("export"));
    assert.ok(code.includes("tool"));
  });

  it(".gitignore excludes sensitive files", () => {
    const gitignore = result.files.find((f) => f.path === ".gitignore");
    assert.ok(gitignore);
    assert.ok(gitignore!.content.includes("node_modules"));
    assert.ok(gitignore!.content.includes(".env"));
  });

  it(".env.example contains credential placeholders", () => {
    const envFile = result.files.find((f) => f.path === ".env.example");
    assert.ok(envFile);
    assert.ok(envFile!.content.includes("ROCKETCHAT_URL"));
  });
});
