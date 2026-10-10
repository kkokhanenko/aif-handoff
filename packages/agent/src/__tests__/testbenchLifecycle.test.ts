import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareQaTestEnvironment, TestbenchLifecycleError } from "../testbenchLifecycle.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("prepareQaTestEnvironment", () => {
  it("binds preparation to the exact Handoff task and revision", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          environment_id: "env-1",
          task_id: "task-1",
          status: "ready",
          revision: { kind: "commit", value: "abc123" },
          browser_evidence_path: "/evidence/task-1/env-1",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      prepareQaTestEnvironment({
        taskId: "task-1",
        revision: "abc123",
        config: { baseUrl: "http://testbench", token: "secret" },
      }),
    ).resolves.toMatchObject({ environment_id: "env-1", task_id: "task-1" });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://testbench/api/environments/prepare",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          idempotency_key: "task-1",
          task_id: "task-1",
          revision_kind: "commit",
          revision: "abc123",
        }),
      }),
    );
  });

  it("preserves structured capacity errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "CAPACITY_BUSY",
              message: "Another task owns the active environment",
              details: { environment_id: "env-other" },
            },
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const result = prepareQaTestEnvironment({
      taskId: "task-2",
      revision: "def456",
      config: { baseUrl: "http://testbench", token: "secret" },
    });
    await expect(result).rejects.toBeInstanceOf(TestbenchLifecycleError);
    await expect(result).rejects.toMatchObject({ code: "CAPACITY_BUSY" });
  });
});
