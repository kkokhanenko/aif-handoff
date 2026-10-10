import { execFileSync } from "node:child_process";
import { getEnv } from "@aif/shared";

export interface PreparedQaEnvironment {
  environment_id: string;
  task_id?: string;
  status: string;
  revision: { kind: "commit" | "worktree"; value: string; content_digest?: string };
  url?: string;
  browser_evidence_path?: string;
}

export class TestbenchLifecycleError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "TestbenchLifecycleError";
  }
}

interface TestbenchConfiguration {
  baseUrl: string;
  token: string;
}

function configuration(): TestbenchConfiguration | null {
  const env = getEnv();
  const baseUrl = env.AIF_TESTBENCH_API_URL?.trim().replace(/\/$/, "");
  const token = env.AIF_TESTBENCH_API_TOKEN?.trim();
  return baseUrl && token ? { baseUrl, token } : null;
}

export function resolveProjectCommit(projectRoot: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export async function prepareQaTestEnvironment(input: {
  taskId: string;
  revision: string;
  config?: TestbenchConfiguration;
}): Promise<PreparedQaEnvironment | null> {
  const config = input.config ?? configuration();
  if (!config) return null;

  const response = await fetch(`${config.baseUrl}/api/environments/prepare`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      idempotency_key: input.taskId,
      task_id: input.taskId,
      revision_kind: "commit",
      revision: input.revision,
    }),
  });
  const payload = (await response.json().catch(() => null)) as
    | PreparedQaEnvironment
    | { error?: { code?: string; message?: string; details?: unknown } }
    | null;
  if (!response.ok) {
    const error = payload && "error" in payload ? payload.error : undefined;
    throw new TestbenchLifecycleError(
      error?.code ?? "TESTBENCH_REQUEST_FAILED",
      error?.message ?? `Testbench request failed with HTTP ${response.status}`,
      error?.details,
    );
  }
  if (!payload || !("environment_id" in payload) || typeof payload.environment_id !== "string") {
    throw new TestbenchLifecycleError(
      "INVALID_TESTBENCH_RESPONSE",
      "Testbench prepare returned no environment",
    );
  }
  return payload;
}

export async function ensureQaTestEnvironment(
  taskId: string,
  projectRoot: string,
): Promise<PreparedQaEnvironment | null> {
  const config = configuration();
  if (!config) return null;
  return await prepareQaTestEnvironment({
    taskId,
    revision: resolveProjectCommit(projectRoot),
    config,
  });
}

export function formatQaTestEnvironmentContext(environment: PreparedQaEnvironment | null): string {
  if (!environment) return "";
  return `

Deterministic Testbench context (prepared by Handoff, not by the model):
- environment_id: ${environment.environment_id}
- owner task_id: ${environment.task_id ?? "unavailable"}
- status: ${environment.status}
- revision: ${environment.revision.kind}:${environment.revision.value}
- preview_url: ${environment.url ?? "request with testbench_get_access"}
- browser_evidence_path: ${environment.browser_evidence_path ?? "request with testbench_get_access"}
Use this exact environment. Calling testbench_prepare again is allowed only with HANDOFF_TASK_ID and the same revision; it must return this environment.`;
}
