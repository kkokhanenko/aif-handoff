import { getEnv } from "@aif/shared";

export interface TestEnvironmentSummary {
  environment_id: string;
  task_id?: string;
  status: string;
  test_result?: "passed" | "failed";
  revision: { kind: "commit" | "worktree"; value: string };
  url?: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
  evidence: string[];
  error?: { code: string; message: string };
}

function configuration(): { baseUrl: string; token: string } | null {
  const env = getEnv();
  const baseUrl = env.AIF_TESTBENCH_API_URL?.trim().replace(/\/$/, "");
  const token = env.AIF_TESTBENCH_API_TOKEN?.trim();
  return baseUrl && token ? { baseUrl, token } : null;
}

async function request<T>(pathname: string, init?: RequestInit): Promise<T> {
  const config = configuration();
  if (!config) throw new Error("Testbench management API is not configured");
  const response = await fetch(`${config.baseUrl}${pathname}`, {
    ...init,
    headers: { Authorization: `Bearer ${config.token}`, ...init?.headers },
  });
  if (!response.ok) throw new Error(`Testbench request failed with HTTP ${response.status}`);
  return (await response.json()) as T;
}

export async function readTestbenchEvidence(
  environmentId: string,
  evidencePath: string,
): Promise<{ contentType: string; buffer: ArrayBuffer }> {
  const config = configuration();
  if (!config) throw new Error("Testbench management API is not configured");
  const response = await fetch(
    `${config.baseUrl}/api/environments/${encodeURIComponent(environmentId)}/evidence?path=${encodeURIComponent(evidencePath)}`,
    { headers: { Authorization: `Bearer ${config.token}` } },
  );
  if (!response.ok)
    throw new Error(`Testbench evidence request failed with HTTP ${response.status}`);
  return {
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
    buffer: await response.arrayBuffer(),
  };
}

export async function findTaskTestEnvironments(taskId: string): Promise<TestEnvironmentSummary[]> {
  return request(`/api/environments?task_id=${encodeURIComponent(taskId)}`);
}

export async function destroyTestEnvironment(
  environmentId: string,
): Promise<TestEnvironmentSummary> {
  return request(`/api/environments/${encodeURIComponent(environmentId)}`, { method: "DELETE" });
}

export function testbenchConfigured(): boolean {
  return configuration() !== null;
}
