import { DslScanner } from "./scanner.js";
import {
  VALID_PARAM_TYPES,
  VALID_STEP_TYPES,
  VALID_WEBHOOK_METHODS,
} from "./constants.js";
import {
  DslParseError,
  type DslStep,
  type DslWebhook,
  type DslWorkflow,
  type ParseDslResult,
} from "./types.js";
import {
  buildDotPath,
  deepMerge,
  isBlockBoundary,
  isWorkflowBoundary,
  parseValue,
} from "./utils.js";

function parseStep(scanner: DslScanner): DslStep {
  const headerLineNumber = scanner.lineNumber;
  const headerLine = scanner.consumeLine().trim();
  const afterStep = headerLine.slice("STEP ".length).trim();
  const colonIdx = afterStep.indexOf(":");

  if (colonIdx < 0) {
    throw new DslParseError(
      headerLineNumber,
      'STEP requires format "STEP id : type"',
    );
  }

  const id = afterStep.slice(0, colonIdx).trim();
  if (!id) {
    throw new DslParseError(headerLineNumber, "STEP requires an id before ':'");
  }

  const afterColon = afterStep.slice(colonIdx + 1).trim();
  const typeParts = afterColon.split(/\s+/);
  const type = typeParts[0];
  if (!type) {
    throw new DslParseError(headerLineNumber, "STEP requires a type after ':'");
  }

  if (typeParts.length > 1) {
    throw new DslParseError(
      headerLineNumber,
      `Unexpected text "${typeParts.slice(1).join(" ")}" after step type "${type}". ` +
        "Use a LABEL keyword on the next line for step descriptions.",
    );
  }

  if (!(VALID_STEP_TYPES as readonly string[]).includes(type)) {
    throw new DslParseError(
      headerLineNumber,
      `Unknown step type "${type}". Valid: ${VALID_STEP_TYPES.join(", ")}`,
    );
  }

  const step: DslStep = { id, type };

  while (!scanner.isEof()) {
    scanner.skipBlanks();
    if (scanner.isEof()) break;
    const next = scanner.peekLine().trim();

    if (isBlockBoundary(next)) break;

    const lineNumber = scanner.lineNumber;
    const line = scanner.consumeLine().trim();

    if (line.startsWith("LABEL ")) {
      step.label = line.slice("LABEL ".length).trim();
      continue;
    }

    if (line.startsWith("DEPENDS ON ")) {
      step.dependsOn = line.slice("DEPENDS ON ".length).trim().split(/\s+/);
      continue;
    }

    if (line.startsWith("OPERATION ")) {
      if (step.operationId) {
        throw new DslParseError(
          lineNumber,
          `Duplicate OPERATION in step "${id}"`,
        );
      }
      step.operationId = line.slice("OPERATION ".length).trim();
      continue;
    }

    if (line.startsWith("OUTPUT_PATH ")) {
      step.outputPath = line.slice("OUTPUT_PATH ".length).trim();
      continue;
    }

    if (line.startsWith("FOR_EACH ")) {
      step.forEach = line.slice("FOR_EACH ".length).trim();
      continue;
    }

    if (line.startsWith("AS ")) {
      step.as = line.slice("AS ".length).trim();
      continue;
    }

    if (line.startsWith("MAP ")) {
      const afterMap = line.slice("MAP ".length).trim();
      const eqIdx = afterMap.indexOf("=");
      if (eqIdx < 0) {
        throw new DslParseError(
          lineNumber,
          'MAP requires format "MAP path = value"',
        );
      }

      const dotPath = afterMap.slice(0, eqIdx).trim();
      const rawValue = afterMap.slice(eqIdx + 1).trim();
      if (!dotPath) {
        throw new DslParseError(
          lineNumber,
          "MAP requires a field path before '='",
        );
      }
      if (!rawValue) {
        throw new DslParseError(
          lineNumber,
          `MAP "${dotPath}" requires a value after '='`,
        );
      }
      if (rawValue === "<<<") {
        throw new DslParseError(
          lineNumber,
          "MAP does not support heredoc (<<<). Use a transform step for complex values.",
        );
      }

      const value = parseValue(rawValue);
      const nested = buildDotPath(dotPath, value);
      if (!step.inputMapping) step.inputMapping = {};
      deepMerge(step.inputMapping, nested);
      continue;
    }

    if (line.startsWith("EXPRESSION ") || line === "EXPRESSION") {
      const rest = line.slice("EXPRESSION".length).trim();
      if (rest === "<<<") {
        step.expression = scanner.consumeHeredoc(lineNumber);
      } else if (rest === "") {
        throw new DslParseError(
          lineNumber,
          "EXPRESSION requires an inline value or heredoc (<<<). Example: EXPRESSION x + 1  or  EXPRESSION <<<",
        );
      } else {
        step.expression = rest;
      }
      continue;
    }

    if (line.startsWith("CONDITION ") || line === "CONDITION") {
      const rest = line.slice("CONDITION".length).trim();
      if (rest === "<<<") {
        step.condition = scanner.consumeHeredoc(lineNumber);
      } else if (rest === "") {
        throw new DslParseError(
          lineNumber,
          "CONDITION requires an inline value or heredoc (<<<)",
        );
      } else {
        step.condition = rest;
      }
      continue;
    }

    if (line.startsWith("THEN ")) {
      step.thenStep = line.slice("THEN ".length).trim();
      continue;
    }

    if (line.startsWith("ELSE ")) {
      step.elseStep = line.slice("ELSE ".length).trim();
      continue;
    }

    if (line.startsWith("PROMPT ") || line === "PROMPT") {
      const rest = line.slice("PROMPT".length).trim();
      if (rest === "<<<") {
        step.prompt = scanner.consumeHeredoc(lineNumber);
      } else if (rest === "") {
        throw new DslParseError(
          lineNumber,
          "PROMPT requires an inline value or heredoc (<<<)",
        );
      } else {
        step.prompt = rest;
      }
      continue;
    }

    if (line.startsWith("SYSTEM_PROMPT ") || line === "SYSTEM_PROMPT") {
      const rest = line.slice("SYSTEM_PROMPT".length).trim();
      if (rest === "<<<") {
        step.systemPrompt = scanner.consumeHeredoc(lineNumber);
      } else if (rest === "") {
        throw new DslParseError(
          lineNumber,
          "SYSTEM_PROMPT requires an inline value or heredoc (<<<)",
        );
      } else {
        step.systemPrompt = rest;
      }
      continue;
    }

    if (line.startsWith("MAX_TOKENS ")) {
      const val = parseInt(line.slice("MAX_TOKENS ".length).trim(), 10);
      if (isNaN(val)) {
        throw new DslParseError(lineNumber, "MAX_TOKENS must be a number");
      }
      step.maxTokens = val;
      continue;
    }

    if (line.startsWith("RESPONSE_FORMAT ")) {
      step.responseFormat = line.slice("RESPONSE_FORMAT ".length).trim();
      continue;
    }

    if (line.startsWith("CONTENT_TEXT ") || line === "CONTENT_TEXT") {
      const rest = line.slice("CONTENT_TEXT".length).trim();
      if (!step.content) step.content = [];
      if (rest === "<<<") {
        step.content.push({
          type: "text",
          text: scanner.consumeHeredoc(lineNumber),
        });
      } else if (rest === "") {
        throw new DslParseError(
          lineNumber,
          "CONTENT_TEXT requires an inline value or heredoc (<<<)",
        );
      } else {
        step.content.push({ type: "text", text: rest });
      }
      continue;
    }

    if (line.startsWith("CONTENT_IMAGE ")) {
      if (!step.content) step.content = [];
      step.content.push({
        type: "image",
        url: line.slice("CONTENT_IMAGE ".length).trim(),
      });
      continue;
    }

    if (line.startsWith("MESSAGE ") || line === "MESSAGE") {
      const rest = line.slice("MESSAGE".length).trim();
      if (rest === "<<<") {
        step.message = scanner.consumeHeredoc(lineNumber);
      } else if (rest === "") {
        throw new DslParseError(
          lineNumber,
          "MESSAGE requires an inline value or heredoc (<<<)",
        );
      } else {
        step.message = rest;
      }
      continue;
    }

    if (line.startsWith("SCHEMA ") || line === "SCHEMA") {
      const rest = line.slice("SCHEMA".length).trim();
      if (rest === "<<<") {
        const raw = scanner.consumeHeredoc(lineNumber);
        try {
          step.requestedSchema = JSON.parse(raw);
        } catch {
          throw new DslParseError(
            lineNumber,
            `Invalid JSON in SCHEMA heredoc: ${raw.slice(0, 60)}`,
          );
        }
      } else if (rest === "") {
        throw new DslParseError(
          lineNumber,
          "SCHEMA requires inline JSON or heredoc (<<<)",
        );
      } else {
        try {
          step.requestedSchema = JSON.parse(rest);
        } catch {
          throw new DslParseError(
            lineNumber,
            `SCHEMA value must be valid JSON: ${rest.slice(0, 60)}`,
          );
        }
      }
      continue;
    }

    if (line.startsWith("ON_DECLINE ")) {
      const val = line.slice("ON_DECLINE ".length).trim();
      if (val !== "abort" && val !== "skip_remaining") {
        throw new DslParseError(
          lineNumber,
          `ON_DECLINE must be "abort" or "skip_remaining", got "${val}"`,
        );
      }
      step.onDecline = val;
      continue;
    }

    if (line === "CONTINUE_ON_ERROR") {
      step.continueOnError = true;
      continue;
    }

    if (line.startsWith("DESCRIPTION ")) {
      throw new DslParseError(
        lineNumber,
        "DESCRIPTION is not valid inside a STEP. Use LABEL instead.",
      );
    }

    const firstChar = line[0];
    if (
      firstChar === "*" ||
      firstChar === "-" ||
      line.charCodeAt(0) === 0x2022 ||
      line.startsWith("{{") ||
      !/^[A-Z]/.test(line)
    ) {
      throw new DslParseError(
        lineNumber,
        `Unexpected content "${line.slice(0, 40)}" in step "${id}" - ` +
          "looks like text meant for a heredoc (<<<...>>>).",
      );
    }

    throw new DslParseError(
      lineNumber,
      `Unknown keyword "${line.split(" ")[0]}" in step "${id}"`,
    );
  }

  return step;
}

function validateStepSemantics(step: DslStep, lineNumber: number): void {
  const { type, id } = step;

  if (type === "api_call" && !step.operationId) {
    throw new DslParseError(
      lineNumber,
      `Step "${id}" (api_call) requires OPERATION`,
    );
  }
  if (
    type === "sampling" &&
    !step.prompt &&
    (!step.content || step.content.length === 0)
  ) {
    throw new DslParseError(
      lineNumber,
      `Step "${id}" (sampling) requires PROMPT or CONTENT_TEXT`,
    );
  }
  if (type === "conditional" && !step.condition) {
    throw new DslParseError(
      lineNumber,
      `Step "${id}" (conditional) requires CONDITION`,
    );
  }
  if (type === "conditional" && !step.thenStep && !step.elseStep) {
    throw new DslParseError(
      lineNumber,
      `Step "${id}" (conditional) requires at least THEN or ELSE`,
    );
  }
  if (type === "transform" && !step.expression) {
    throw new DslParseError(
      lineNumber,
      `Step "${id}" (transform) requires EXPRESSION`,
    );
  }
  if (type === "elicitation" && !step.message) {
    throw new DslParseError(
      lineNumber,
      `Step "${id}" (elicitation) requires MESSAGE`,
    );
  }
  if (step.forEach && !step.as) {
    throw new DslParseError(lineNumber, `Step "${id}" has FOR_EACH without AS`);
  }
  if (step.as && !step.forEach) {
    throw new DslParseError(lineNumber, `Step "${id}" has AS without FOR_EACH`);
  }
}

function parseWorkflow(scanner: DslScanner): DslWorkflow {
  const headerLineNumber = scanner.lineNumber;
  const headerLine = scanner.consumeLine().trim();
  const name = headerLine.slice("WORKFLOW ".length).trim();
  if (!name) {
    throw new DslParseError(headerLineNumber, "WORKFLOW requires a name");
  }

  const workflow: DslWorkflow = { name, description: "", steps: [] };

  while (!scanner.isEof()) {
    scanner.skipBlanks();
    if (scanner.isEof()) break;
    const next = scanner.peekLine().trim();

    if (isWorkflowBoundary(next)) break;

    const lineNumber = scanner.lineNumber;

    if (next === "STEP") {
      scanner.consumeLine();
      throw new DslParseError(
        lineNumber,
        'STEP requires format "STEP id : type"',
      );
    }

    if (next.startsWith("STEP ")) {
      const stepStartLine = scanner.lineNumber;
      const step = parseStep(scanner);
      validateStepSemantics(step, stepStartLine);
      const duplicate = workflow.steps.find((s) => s.id === step.id);
      if (duplicate) {
        throw new DslParseError(
          stepStartLine,
          `Duplicate step ID "${step.id}" in workflow "${name}"`,
        );
      }
      workflow.steps.push(step);
      continue;
    }

    if (next.startsWith("DESCRIPTION ")) {
      scanner.consumeLine();
      if (workflow.description) {
        throw new DslParseError(
          lineNumber,
          `Duplicate DESCRIPTION in workflow "${name}"`,
        );
      }
      workflow.description = next.slice("DESCRIPTION ".length).trim();
      continue;
    }

    if (next.startsWith("PARAM ")) {
      const line = scanner.consumeLine().trim();
      const afterParam = line.slice("PARAM ".length).trim();

      const firstColon = afterParam.indexOf(":");
      if (firstColon < 0) {
        throw new DslParseError(
          lineNumber,
          'PARAM requires format "PARAM name : type" or "PARAM name : type : description"',
        );
      }

      const paramName = afterParam.slice(0, firstColon).trim();
      if (!paramName) {
        throw new DslParseError(lineNumber, "PARAM requires a name before ':'");
      }

      const secondColon = afterParam.indexOf(":", firstColon + 1);
      const paramType = afterParam
        .slice(firstColon + 1, secondColon >= 0 ? secondColon : undefined)
        .trim();
      const paramDesc =
        secondColon >= 0
          ? afterParam.slice(secondColon + 1).trim() || undefined
          : undefined;

      if (!(VALID_PARAM_TYPES as readonly string[]).includes(paramType)) {
        throw new DslParseError(
          lineNumber,
          `PARAM type "${paramType}" invalid. Valid: ${VALID_PARAM_TYPES.join(", ")}`,
        );
      }

      if (workflow.params && paramName in workflow.params.properties) {
        throw new DslParseError(
          lineNumber,
          `Duplicate PARAM "${paramName}" in workflow "${name}"`,
        );
      }

      if (!workflow.params) {
        workflow.params = { type: "object", properties: {} };
      }
      workflow.params.properties[paramName] = paramDesc
        ? { type: paramType, description: paramDesc }
        : { type: paramType };
      continue;
    }

    scanner.consumeLine();
    throw new DslParseError(
      lineNumber,
      `Unknown keyword "${next.split(" ")[0]}" in workflow "${name}"`,
    );
  }

  if (workflow.steps.length === 0) {
    throw new DslParseError(
      headerLineNumber,
      `WORKFLOW "${name}" has no STEP declarations`,
    );
  }

  const stepIds = new Set(workflow.steps.map((step) => step.id));
  for (const step of workflow.steps) {
    if (step.thenStep && !stepIds.has(step.thenStep)) {
      throw new DslParseError(
        headerLineNumber,
        `Step "${step.id}" THEN references unknown step "${step.thenStep}" in workflow "${name}"`,
      );
    }
    if (step.elseStep && !stepIds.has(step.elseStep)) {
      throw new DslParseError(
        headerLineNumber,
        `Step "${step.id}" ELSE references unknown step "${step.elseStep}" in workflow "${name}"`,
      );
    }
    if (step.dependsOn) {
      for (const dep of step.dependsOn) {
        if (!stepIds.has(dep)) {
          throw new DslParseError(
            headerLineNumber,
            `Step "${step.id}" DEPENDS ON unknown step "${dep}" in workflow "${name}"`,
          );
        }
      }
    }
  }

  return workflow;
}

function parseWebhook(scanner: DslScanner): DslWebhook {
  const headerLineNumber = scanner.lineNumber;
  const headerLine = scanner.consumeLine().trim();
  const path = headerLine.slice("WEBHOOK ".length).trim();
  if (!path) {
    throw new DslParseError(headerLineNumber, "WEBHOOK requires a path");
  }

  const webhook: DslWebhook = { path, description: "", methods: [] };

  while (!scanner.isEof()) {
    scanner.skipBlanks();
    if (scanner.isEof()) break;
    const next = scanner.peekLine().trim();

    if (isWorkflowBoundary(next)) break;

    const lineNumber = scanner.lineNumber;
    const line = scanner.consumeLine().trim();

    if (line.startsWith("DESCRIPTION ")) {
      webhook.description = line.slice("DESCRIPTION ".length).trim();
      continue;
    }

    if (line.startsWith("METHODS ")) {
      const methods = line
        .slice("METHODS ".length)
        .trim()
        .split(/\s+/)
        .map((m) => m.toLowerCase());
      for (const m of methods) {
        if (!(VALID_WEBHOOK_METHODS as readonly string[]).includes(m)) {
          throw new DslParseError(
            lineNumber,
            `Invalid HTTP method "${m}" in WEBHOOK. Valid: ${VALID_WEBHOOK_METHODS.join(", ")}`,
          );
        }
      }
      webhook.methods = methods as ("get" | "post")[];
      continue;
    }

    throw new DslParseError(
      lineNumber,
      `Unknown keyword in WEBHOOK context: "${line.split(" ")[0]}"`,
    );
  }

  if (webhook.methods.length === 0) {
    throw new DslParseError(
      headerLineNumber,
      `WEBHOOK "${path}" requires at least one method (METHODS get post)`,
    );
  }

  return webhook;
}

/**
 * Parses a DSL string into a structured workflow definition.
 * @throws {DslParseError} on invalid input with line-number context.
 */
export function parseDsl(dsl: string): ParseDslResult {
  const scanner = new DslScanner(dsl);
  let projectName: string | undefined;
  let projectDescription: string | undefined;
  const workflows: DslWorkflow[] = [];
  const workflowNames = new Set<string>();
  const webhooks: DslWebhook[] = [];

  while (!scanner.isEof()) {
    scanner.skipBlanks();
    if (scanner.isEof()) break;
    const line = scanner.peekLine().trim();

    const lineNumber = scanner.lineNumber;

    if (line.startsWith("PROJECT ")) {
      scanner.consumeLine();
      projectName = line.slice("PROJECT ".length).trim();
      continue;
    }

    if (line.startsWith("DESCRIPTION ") && workflows.length === 0) {
      if (projectDescription !== undefined) {
        throw new DslParseError(
          lineNumber,
          "Duplicate DESCRIPTION at project level",
        );
      }
      scanner.consumeLine();
      projectDescription = line.slice("DESCRIPTION ".length).trim();
      continue;
    }

    if (line.startsWith("WORKFLOW ")) {
      const workflow = parseWorkflow(scanner);
      if (workflowNames.has(workflow.name)) {
        throw new DslParseError(
          lineNumber,
          `Duplicate WORKFLOW name "${workflow.name}"`,
        );
      }
      workflowNames.add(workflow.name);
      workflows.push(workflow);
      continue;
    }

    if (line.startsWith("WEBHOOK ")) {
      webhooks.push(parseWebhook(scanner));
      continue;
    }

    if (line === "WEBHOOK") {
      throw new DslParseError(lineNumber, "WEBHOOK requires a path");
    }

    if (line === "WORKFLOW") {
      throw new DslParseError(lineNumber, "WORKFLOW requires a name");
    }

    scanner.consumeLine();
    throw new DslParseError(
      lineNumber,
      `Unexpected content at root level: "${line.slice(0, 40)}"`,
    );
  }

  if (!projectName) {
    throw new DslParseError(1, "Missing PROJECT declaration");
  }
  if (!projectDescription) {
    throw new DslParseError(1, "Missing project DESCRIPTION");
  }
  if (workflows.length === 0) {
    throw new DslParseError(1, "No WORKFLOW declarations found");
  }

  return {
    projectName,
    description: projectDescription,
    workflows,
    webhookEndpoints: webhooks.length > 0 ? webhooks : undefined,
  };
}
