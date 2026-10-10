import { execFile, execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type {
  RuntimeEvent,
  RuntimeModel,
  RuntimeRunInput,
  RuntimeRunResult,
  RuntimeUsage,
} from "../../types.js";
import {
  makeProcessRunTimeoutError,
  makeProcessStartTimeoutError,
  resolveRetryDelay,
  sleepMs,
  withProcessTimeouts,
} from "../../timeouts.js";
import { classifyPiRuntimeError, PiRuntimeAdapterError } from "./errors.js";

const execFileAsync = promisify(execFile);
const DEFAULT_PROVIDER = "openai-codex";
const DEFAULT_RUN_TIMEOUT_MS = 60 * 60 * 1_000;
const EFFORT_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const BLOCKED_OPENAI_ENV_KEYS = new Set(["OPENAI_API_KEY", "OPENAI_BASE_URL"]);

export interface PiCliLogger {
  debug?(context: Record<string, unknown>, message: string): void;
  info?(context: Record<string, unknown>, message: string): void;
  warn?(context: Record<string, unknown>, message: string): void;
  error?(context: Record<string, unknown>, message: string): void;
}

interface PiAssistantMessage {
  role?: string;
  content?: Array<{ type?: string; text?: string }>;
  usage?: {
    input?: number;
    output?: number;
    totalTokens?: number;
    cost?: { total?: number };
  };
  stopReason?: string;
  errorMessage?: string;
}

interface PiJsonEvent {
  type?: string;
  id?: string;
  message?: PiAssistantMessage;
  assistantMessageEvent?: {
    type?: string;
    delta?: string;
  };
  toolName?: string;
  args?: unknown;
  aborted?: boolean;
}

interface PiStreamState {
  sessionId: string | null;
  outputText: string;
  usage: RuntimeUsage | null;
  events: RuntimeEvent[];
  rawEvents: PiJsonEvent[];
  assistantError: string | null;
  settled: boolean;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function resolvePiCliPath(options?: Record<string, unknown>): string {
  return readString(options?.piCliPath) ?? readString(process.env.PI_CLI_PATH) ?? "pi";
}

function resolveProvider(options?: Record<string, unknown>): string {
  return readString(options?.piProvider) ?? DEFAULT_PROVIDER;
}

function resolveEffort(options?: Record<string, unknown>): string | null {
  const effort = readString(options?.modelReasoningEffort);
  return effort && EFFORT_LEVELS.has(effort) ? effort : null;
}

function buildPiEnv(executionEnvironment?: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!BLOCKED_OPENAI_ENV_KEYS.has(key) && value !== undefined) environment[key] = value;
  }
  for (const [key, value] of Object.entries(executionEnvironment ?? {})) {
    if (!BLOCKED_OPENAI_ENV_KEYS.has(key) && value !== undefined) environment[key] = value;
  }
  return environment;
}

function composePrompt(input: RuntimeRunInput): string {
  const append = input.execution?.systemPromptAppend?.trim();
  const prompt = input.prompt.replace(/(^|\s)\/aif-([a-z0-9-]+)/gi, "$1/skill:aif-$2");
  return append ? `${append}\n\n${prompt}` : prompt;
}

function findSkillDirectories(projectRoot: string | undefined): string[] {
  if (!projectRoot) return [];
  const roots = [
    join(projectRoot, ".agents", "skills"),
    join(projectRoot, ".claude", "skills"),
    join(projectRoot, ".codex", "skills"),
  ];
  const found = new Map<string, string>();
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = join(root, entry.name);
      if (existsSync(join(directory, "SKILL.md")) && !found.has(entry.name)) {
        found.set(entry.name, directory);
      }
    }
  }
  return [...found.values()];
}

function buildArgs(input: RuntimeRunInput, sessionId: string): string[] {
  const options = asRecord(input.options);
  const args = [
    "--mode",
    "json",
    "--print",
    "--approve",
    "--provider",
    resolveProvider(options),
    "--session-id",
    sessionId,
  ];
  if (input.model) args.push("--model", input.model);
  const effort = resolveEffort(options);
  if (effort) args.push("--thinking", effort);
  for (const skillDirectory of findSkillDirectories(input.projectRoot)) {
    args.push("--skill", skillDirectory);
  }
  args.push("--", composePrompt(input));
  return args;
}

function emit(
  state: PiStreamState,
  execution: RuntimeRunInput["execution"],
  event: RuntimeEvent,
): void {
  state.events.push(event);
  execution?.onEvent?.(event);
}

function messageText(message: PiAssistantMessage): string {
  return (message.content ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("");
}

function messageUsage(message: PiAssistantMessage): RuntimeUsage | null {
  const usage = message.usage;
  if (!usage) return null;
  const inputTokens = usage.input ?? 0;
  const outputTokens = usage.output ?? 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: usage.totalTokens ?? inputTokens + outputTokens,
    costUsd: usage.cost?.total,
  };
}

function processJsonLine(
  line: string,
  state: PiStreamState,
  execution: RuntimeRunInput["execution"],
): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new PiRuntimeAdapterError(
      "Pi emitted an invalid JSONL record",
      "PI_INVALID_JSONL",
      "stream",
      error,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
  const event = parsed as PiJsonEvent;
  state.rawEvents.push(event);
  const now = new Date().toISOString();

  if (event.type === "session" && readString(event.id)) {
    state.sessionId = readString(event.id);
    emit(state, execution, {
      type: "system:init",
      timestamp: now,
      level: "debug",
      message: "Pi session started",
      data: { sessionId: state.sessionId },
    });
    return;
  }
  if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
    const delta = readString(event.assistantMessageEvent.delta);
    if (delta) {
      emit(state, execution, {
        type: "stream:text",
        timestamp: now,
        level: "debug",
        message: delta,
        data: { text: delta },
      });
    }
    return;
  }
  if (event.type === "tool_execution_start" && readString(event.toolName)) {
    const toolName = readString(event.toolName) ?? "Tool";
    const detail = JSON.stringify(event.args ?? {});
    emit(state, execution, {
      type: "tool:use",
      timestamp: now,
      level: "info",
      message: `${toolName} ${detail.slice(0, 160)}`.trim(),
      data: { name: toolName, args: event.args },
    });
    execution?.onToolUse?.(toolName, detail.slice(0, 160));
    return;
  }
  if (event.type === "message_end" && event.message?.role === "assistant") {
    state.outputText = messageText(event.message);
    state.usage = messageUsage(event.message);
    if (event.message.stopReason === "error" || event.message.stopReason === "aborted") {
      state.assistantError =
        event.message.errorMessage ?? `Pi stopped: ${event.message.stopReason}`;
    }
    return;
  }
  if (event.type === "agent_settled") {
    state.settled = true;
    if (event.aborted) state.assistantError = state.assistantError ?? "Pi run was aborted";
  }
}

function runAttempt(
  input: RuntimeRunInput,
  cliPath: string,
  sessionId: string,
  logger?: PiCliLogger,
): Promise<{ result: RuntimeRunResult | null; startTimedOut: boolean }> {
  const child = spawn(cliPath, buildArgs(input, sessionId), {
    cwd: input.cwd ?? input.projectRoot,
    // The openai-codex provider must use Pi's stored OAuth subscription. Ambient
    // API variables would silently switch billing/authentication semantics.
    env: buildPiEnv(input.execution?.environment),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const runTimeoutMs = input.execution?.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
  const timeouts = withProcessTimeouts(child, {
    startTimeoutMs: input.execution?.startTimeoutMs,
    runTimeoutMs,
  });
  const state: PiStreamState = {
    sessionId,
    outputText: "",
    usage: null,
    events: [],
    rawEvents: [],
    assistantError: null,
    settled: false,
  };
  let stdout = "";
  let stderr = "";
  let parseError: unknown = null;

  child.stdout?.on("data", (chunk: Buffer | string) => {
    stdout += String(chunk);
    let index = stdout.indexOf("\n");
    while (index !== -1) {
      const line = stdout.slice(0, index);
      stdout = stdout.slice(index + 1);
      try {
        processJsonLine(line, state, input.execution);
      } catch (error) {
        parseError = error;
      }
      index = stdout.indexOf("\n");
    }
  });
  child.stderr?.on("data", (chunk: Buffer | string) => {
    const text = String(chunk);
    stderr += text;
    input.execution?.onStderr?.(text);
  });
  input.execution?.abortController?.signal.addEventListener("abort", () => child.kill("SIGTERM"), {
    once: true,
  });

  return new Promise((resolve, reject) => {
    child.on("error", (error) => {
      timeouts.cleanup();
      reject(classifyPiRuntimeError(error));
    });
    child.on("close", async (code) => {
      timeouts.cleanup();
      if (stdout.trim()) {
        try {
          processJsonLine(stdout, state, input.execution);
        } catch (error) {
          parseError = error;
        }
      }
      const startTimedOut = await timeouts.startTimedOut;
      if (startTimedOut) {
        resolve({ result: null, startTimedOut: true });
        return;
      }
      if (timeouts.runTimedOut) {
        reject(makeProcessRunTimeoutError(runTimeoutMs));
        return;
      }
      if (parseError) {
        reject(classifyPiRuntimeError(parseError));
        return;
      }
      if (code !== 0) {
        reject(classifyPiRuntimeError(new Error(`Pi CLI exited with code ${code}: ${stderr}`)));
        return;
      }
      if (state.assistantError) {
        reject(classifyPiRuntimeError(new Error(state.assistantError)));
        return;
      }
      if (!state.settled || !state.outputText) {
        reject(
          new PiRuntimeAdapterError(
            "Pi completed without a settled assistant response",
            "PI_INCOMPLETE_RESPONSE",
            "stream",
          ),
        );
        return;
      }
      logger?.debug?.(
        {
          runtimeId: input.runtimeId,
          sessionId: state.sessionId,
          eventCount: state.rawEvents.length,
        },
        "Pi CLI run completed",
      );
      resolve({
        startTimedOut: false,
        result: {
          outputText: state.outputText,
          sessionId: state.sessionId,
          events: state.events,
          usage: state.usage,
          raw: state.rawEvents,
        },
      });
    });
  });
}

export async function runPiCli(
  input: RuntimeRunInput,
  logger?: PiCliLogger,
): Promise<RuntimeRunResult> {
  const cliPath = resolvePiCliPath(asRecord(input.options));
  const sessionId = input.sessionId ?? randomUUID();
  const first = await runAttempt(input, cliPath, sessionId, logger);
  if (!first.startTimedOut && first.result) return first.result;

  const startTimeoutMs = input.execution?.startTimeoutMs ?? 0;
  await sleepMs(resolveRetryDelay(input.execution ?? {}));
  const retry = await runAttempt(input, cliPath, sessionId, logger);
  if (retry.startTimedOut || !retry.result) throw makeProcessStartTimeoutError(startTimeoutMs);
  return retry.result;
}

export function probePiCli(cliPath: string): { ok: boolean; version?: string; error?: string } {
  try {
    const output = execFileSync(cliPath, ["--version"], {
      timeout: 5_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return { ok: true, version: output.toString().trim() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function validatePiAuth(
  cliPath: string,
  provider: string,
): Promise<{ ok: boolean; message: string }> {
  try {
    const { stdout } = await execFileAsync(
      cliPath,
      ["auth", "check", "--provider", provider, "--json", "--no-refresh"],
      { timeout: 10_000 },
    );
    const parsed = JSON.parse(stdout) as { status?: string; authType?: string };
    if (parsed.status === "ready") {
      return {
        ok: true,
        message: `Pi ${provider} authentication is ready (${parsed.authType ?? "configured"})`,
      };
    }
    return { ok: false, message: `Pi ${provider} authentication is not ready` };
  } catch (error) {
    return { ok: false, message: classifyPiRuntimeError(error).message };
  }
}

export async function listPiModels(cliPath: string, provider: string): Promise<RuntimeModel[]> {
  const { stdout } = await execFileAsync(cliPath, ["--offline", "--list-models", provider], {
    timeout: 15_000,
  });
  const models: RuntimeModel[] = [];
  for (const line of stdout.split(/\r?\n/).slice(1)) {
    const columns = line.trim().split(/\s{2,}/);
    if (columns.length < 2 || columns[0] !== provider) continue;
    const id = columns[1];
    models.push({
      id,
      label: id,
      supportsStreaming: true,
      metadata: {
        supportsEffort: columns[4] === "yes",
        ...(columns[4] === "yes"
          ? { supportedEffortLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"] }
          : {}),
      },
    });
  }
  return models;
}
