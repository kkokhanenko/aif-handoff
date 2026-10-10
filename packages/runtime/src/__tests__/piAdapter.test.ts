import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPiRuntimeAdapter } from "../adapters/pi/index.js";
import { UsageSource, type RuntimeRunInput } from "../types.js";

const FAKE_PI = `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes('--version')) {
  console.log('1.1.0-test');
  process.exit(0);
}
if (args[0] === 'auth' && args[1] === 'check') {
  console.log(JSON.stringify({ status: 'ready', provider: 'openai-codex', authType: 'oauth' }));
  process.exit(0);
}
if (args.includes('--list-models')) {
  console.log('provider      model        context  max-out  thinking  images');
  console.log('openai-codex  gpt-6.1-sol  272K     128K     yes       yes');
  console.log('openai-codex  gpt-6-luna   272K     128K     yes       yes');
  process.exit(0);
}
const sessionIndex = args.indexOf('--session-id');
const sessionId = sessionIndex >= 0 ? args[sessionIndex + 1] : 'test-session';
console.log(JSON.stringify({ type: 'session', version: 3, id: sessionId, timestamp: new Date().toISOString(), cwd: process.cwd() }));
console.log(JSON.stringify({ type: 'agent_start' }));
console.log(JSON.stringify({ type: 'tool_execution_start', toolCallId: 'tool-1', toolName: 'read', args: { path: 'README.md' } }));
console.log(JSON.stringify({ type: 'message_update', usage: { input: 12, output: 1, totalTokens: 13 }, assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'PI_' } }));
const output = process.env.OPENAI_API_KEY || process.env.OPENAI_BASE_URL ? 'PI_ENV_LEAK' : 'PI_OK';
console.log(JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: output }], usage: { input: 12, output: 2, totalTokens: 14, cost: { total: 0.001 } }, stopReason: 'stop' } }));
console.log(JSON.stringify({ type: 'agent_settled', aborted: false }));
`;

describe("Pi runtime adapter", () => {
  let directory: string;
  let cliPath: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "aif-pi-adapter-"));
    cliPath = join(directory, "pi-fake.mjs");
    writeFileSync(cliPath, FAKE_PI, "utf8");
    chmodSync(cliPath, 0o755);
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  function runInput(overrides: Partial<RuntimeRunInput> = {}): RuntimeRunInput {
    return {
      runtimeId: "pi",
      providerId: "openai-codex",
      model: "gpt-6.1-sol",
      prompt: "/aif-plan test",
      projectRoot: directory,
      options: { piCliPath: cliPath, modelReasoningEffort: "medium" },
      usageContext: { source: UsageSource.TEST },
      ...overrides,
    };
  }

  it("maps Pi JSONL output, usage, tool activity, and session id", async () => {
    const onEvent = vi.fn();
    const onToolUse = vi.fn();
    const adapter = createPiRuntimeAdapter();
    const result = await adapter.run(
      runInput({
        execution: { onEvent, onToolUse, startTimeoutMs: 2_000, runTimeoutMs: 5_000 },
      }),
    );

    expect(result.outputText).toBe("PI_OK");
    expect(result.sessionId).toBeTruthy();
    expect(result.usage).toEqual({
      inputTokens: 12,
      outputTokens: 2,
      totalTokens: 14,
      costUsd: 0.001,
    });
    expect(onToolUse).toHaveBeenCalledWith("read", expect.stringContaining("README.md"));
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "stream:text" }));
  });

  it("keeps ambient OpenAI API variables from overriding subscription OAuth", async () => {
    vi.stubEnv("OPENAI_API_KEY", "must-not-reach-pi");
    vi.stubEnv("OPENAI_BASE_URL", "https://must-not-reach-pi.invalid");
    const adapter = createPiRuntimeAdapter();
    const result = await adapter.run(
      runInput({
        execution: {
          environment: {
            OPENAI_API_KEY: "also-blocked",
            OPENAI_BASE_URL: "https://also-blocked.invalid",
          },
        },
      }),
    );

    expect(result.outputText).toBe("PI_OK");
    vi.unstubAllEnvs();
  });

  it("reuses the supplied Pi session id on resume", async () => {
    const adapter = createPiRuntimeAdapter();
    const result = await adapter.resume!(
      runInput({ sessionId: "existing-session", resume: true }) as RuntimeRunInput & {
        sessionId: string;
      },
    );

    expect(result.sessionId).toBe("existing-session");
  });

  it("validates OAuth readiness without exposing credentials", async () => {
    const adapter = createPiRuntimeAdapter();
    const result = await adapter.validateConnection!({
      runtimeId: "pi",
      providerId: "openai-codex",
      model: "gpt-6.1-sol",
      transport: "cli",
      options: { piCliPath: cliPath },
    });

    expect(result.ok).toBe(true);
    expect(result.message).toContain("oauth");
  });

  it("discovers subscription models from the Pi catalog", async () => {
    const adapter = createPiRuntimeAdapter();
    const models = await adapter.listModels!({
      runtimeId: "pi",
      providerId: "openai-codex",
      transport: "cli",
      options: { piCliPath: cliPath },
    });

    expect(models.map((model) => model.id)).toEqual(["gpt-6.1-sol", "gpt-6-luna"]);
    expect(models[0].metadata?.supportedEffortLevels).toContain("max");
  });
});
