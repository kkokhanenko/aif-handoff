import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { projects, tasks } from "@aif/shared";
import { createTestDb } from "@aif/shared/server";

const testDb = { current: createTestDb() };
const executeSubagentQueryMock = vi.fn();
const logActivityMock = vi.fn();

vi.mock("@aif/shared/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aif/shared/server")>();
  return {
    ...actual,
    getDb: () => testDb.current,
  };
});

vi.mock("../subagentQuery.js", () => ({
  executeSubagentQuery: executeSubagentQueryMock,
}));

vi.mock("../hooks.js", () => ({
  logActivity: logActivityMock,
}));

const { runVerifier } = await import("../subagents/verifier.js");

describe("runVerifier", () => {
  beforeEach(() => {
    testDb.current = createTestDb();
    executeSubagentQueryMock.mockReset();
    logActivityMock.mockReset();

    testDb.current
      .insert(projects)
      .values({
        id: "project-1",
        name: "Test",
        rootPath: "/tmp/verifier-test",
        implementerMaxBudgetUsd: 5,
        reviewSidecarMaxBudgetUsd: 3,
      })
      .run();
  });

  it("runs aif-verify in standard slash-command mode and appends verification output", async () => {
    testDb.current
      .insert(tasks)
      .values({
        id: "task-1",
        projectId: "project-1",
        title: "Task",
        description: "Desc",
        status: "verify",
        reviewComments: "## Code Review\n\nLooks good",
      })
      .run();

    executeSubagentQueryMock.mockResolvedValueOnce({
      resultText:
        'Verification passed\n\n```aif-gate-result\n{"status":"pass","blocking":false}\n```',
    });

    await runVerifier("task-1", "/tmp/verifier-test");

    expect(executeSubagentQueryMock).toHaveBeenCalledTimes(1);
    const call = executeSubagentQueryMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.agentName).toBe("aif-verify");
    expect(call.profileMode).toBe("review");
    expect(call.maxBudgetUsd).toBe(3);
    expect(call.fallbackSlashCommand).toBe("/aif-verify");
    expect(call.workflowSpec).toEqual(
      expect.objectContaining({
        executionMode: "standard",
        sessionReusePolicy: "new_session",
      }),
    );

    const updatedTask = testDb.current.select().from(tasks).where(eq(tasks.id, "task-1")).get();
    expect(updatedTask?.reviewComments).toContain("## Code Review");
    expect(updatedTask?.reviewComments).toContain("## Verification");
    expect(updatedTask?.reviewComments).toContain("Verification passed");
    expect(logActivityMock).toHaveBeenCalledWith(
      "task-1",
      "Agent",
      "verify stage complete (aif-verify)",
    );
  });

  it("throws when the structured verify gate is blocking", async () => {
    testDb.current
      .insert(tasks)
      .values({
        id: "task-blocked",
        projectId: "project-1",
        title: "Task",
        description: "Desc",
        status: "verify",
      })
      .run();

    executeSubagentQueryMock.mockResolvedValueOnce({
      resultText:
        'Verification failed\n\n```aif-gate-result\n{"status":"fail","blocking":true,"blockers":["missing test"]}\n```',
    });

    await expect(runVerifier("task-blocked", "/tmp/verifier-test")).rejects.toThrow(
      "Verify stage returned a blocking gate result",
    );
    expect(executeSubagentQueryMock).toHaveBeenCalledTimes(1);
  });

  it("completes a QA task when testing finished with product defects", async () => {
    testDb.current
      .insert(tasks)
      .values({
        id: "task-qa-fail",
        projectId: "project-1",
        title: "Full browser QA",
        description: "Test without product changes",
        taskKind: "qa",
        status: "verify",
      })
      .run();
    executeSubagentQueryMock.mockResolvedValueOnce({
      resultText:
        'QA completed with defects\n```aif-gate-result\n{"status":"fail","blocking":false,"execution_status":"completed","qa_verdict":"fail"}\n```',
    });

    await expect(runVerifier("task-qa-fail", "/tmp/verifier-test")).resolves.toBeUndefined();
    const call = executeSubagentQueryMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.prompt).toContain("task_id to every testbench_prepare call");
    expect(call.prompt).toContain("browser_evidence_path returned by Testbench access");
    const updated = testDb.current.select().from(tasks).where(eq(tasks.id, "task-qa-fail")).get();
    expect(updated?.qaVerdict).toBe("fail");
    expect(logActivityMock).toHaveBeenCalledWith(
      "task-qa-fail",
      "Agent",
      "QA execution complete; product verdict=fail",
    );
  });

  it("blocks a QA task when test execution itself did not complete", async () => {
    testDb.current
      .insert(tasks)
      .values({
        id: "task-qa-blocked",
        projectId: "project-1",
        title: "Full browser QA",
        description: "Test without product changes",
        taskKind: "qa",
        status: "verify",
      })
      .run();
    executeSubagentQueryMock.mockResolvedValueOnce({
      resultText:
        'Environment unavailable\n```aif-gate-result\n{"status":"fail","blocking":true,"execution_status":"blocked"}\n```',
    });

    await expect(runVerifier("task-qa-blocked", "/tmp/verifier-test")).rejects.toThrow(
      "QA execution blocked",
    );
    const updated = testDb.current
      .select()
      .from(tasks)
      .where(eq(tasks.id, "task-qa-blocked"))
      .get();
    expect(updated?.qaVerdict).toBe("blocked");
  });

  it("runs the exact allowlisted aif-fix remediation and verifies again", async () => {
    testDb.current
      .insert(tasks)
      .values({
        id: "task-remediated",
        projectId: "project-1",
        title: "Document module",
        description: "Keep docs aligned with code",
        status: "verify",
      })
      .run();

    executeSubagentQueryMock
      .mockResolvedValueOnce({
        resultText:
          'First verification\n\n```aif-gate-result\n{"status":"fail","blocking":true,"blockers":[{"file":"docs/user-guide.md","summary":"Incorrect behavior"}],"suggested_next":{"command":"/aif-fix","reason":"Correct the documentation"}}\n```',
      })
      .mockResolvedValueOnce({ resultText: "Fix applied" })
      .mockResolvedValueOnce({
        resultText:
          'Second verification\n\n```aif-gate-result\n{"status":"pass","blocking":false}\n```',
      });

    await runVerifier("task-remediated", "/tmp/verifier-test");

    expect(executeSubagentQueryMock).toHaveBeenCalledTimes(3);
    const fixCall = executeSubagentQueryMock.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(fixCall.agentName).toBe("aif-fix");
    expect(fixCall.profileMode).toBe("task");
    expect(fixCall.maxBudgetUsd).toBe(5);
    expect(fixCall.fallbackSlashCommand).toMatch(/^\/aif-fix /);
    expect(fixCall.prompt).toContain("Fix now. Do not ask interactive questions");
    expect(fixCall.prompt).toContain("Incorrect behavior");
    expect(fixCall.workflowSpec).toEqual(
      expect.objectContaining({
        executionMode: "standard",
        sessionReusePolicy: "never",
      }),
    );

    const updatedTask = testDb.current
      .select()
      .from(tasks)
      .where(eq(tasks.id, "task-remediated"))
      .get();
    expect(updatedTask?.reviewComments).toContain("## Verification\n\nFirst verification");
    expect(updatedTask?.reviewComments).toContain(
      "## Verification after fix 1\n\nSecond verification",
    );
    expect(logActivityMock).toHaveBeenCalledWith(
      "task-remediated",
      "Agent",
      "verify auto-fix 1/2 started (aif-fix)",
    );
    expect(logActivityMock).toHaveBeenCalledWith(
      "task-remediated",
      "Agent",
      "verify auto-fix 1/2 complete; rerunning aif-verify",
    );
  });

  it("blocks after the bounded aif-fix attempts are exhausted", async () => {
    testDb.current
      .insert(tasks)
      .values({
        id: "task-nonconverging",
        projectId: "project-1",
        title: "Task",
        description: "Desc",
        status: "verify",
      })
      .run();

    const blockingResult = {
      resultText:
        'Still failing\n\n```aif-gate-result\n{"status":"fail","blocking":true,"suggested_next":{"command":"/aif-fix"}}\n```',
    };
    executeSubagentQueryMock
      .mockResolvedValueOnce(blockingResult)
      .mockResolvedValueOnce({ resultText: "Fix one" })
      .mockResolvedValueOnce(blockingResult)
      .mockResolvedValueOnce({ resultText: "Fix two" })
      .mockResolvedValueOnce(blockingResult);

    await expect(runVerifier("task-nonconverging", "/tmp/verifier-test")).rejects.toThrow(
      "Verify stage returned a blocking gate result",
    );
    expect(executeSubagentQueryMock).toHaveBeenCalledTimes(5);

    const updatedTask = testDb.current
      .select()
      .from(tasks)
      .where(eq(tasks.id, "task-nonconverging"))
      .get();
    expect(updatedTask?.reviewComments).toContain("## Verification after fix 2");
  });

  it("does not execute unsupported suggested commands", async () => {
    testDb.current
      .insert(tasks)
      .values({
        id: "task-unsupported",
        projectId: "project-1",
        title: "Task",
        description: "Desc",
        status: "verify",
      })
      .run();

    executeSubagentQueryMock.mockResolvedValueOnce({
      resultText:
        'Verification failed\n\n```aif-gate-result\n{"status":"fail","blocking":true,"suggested_next":{"command":"/aif-rules"}}\n```',
    });

    await expect(runVerifier("task-unsupported", "/tmp/verifier-test")).rejects.toThrow();
    expect(executeSubagentQueryMock).toHaveBeenCalledTimes(1);
  });

  it("uses only the final structured gate result", async () => {
    testDb.current
      .insert(tasks)
      .values({
        id: "task-final-gate",
        projectId: "project-1",
        title: "Task",
        description: "Desc",
        status: "verify",
      })
      .run();

    executeSubagentQueryMock.mockResolvedValueOnce({
      resultText:
        'Draft\n```aif-gate-result\n{"status":"fail","blocking":true,"suggested_next":{"command":"/aif-fix"}}\n```\nFinal\n```aif-gate-result\n{"status":"pass","blocking":false}\n```',
    });

    await runVerifier("task-final-gate", "/tmp/verifier-test");
    expect(executeSubagentQueryMock).toHaveBeenCalledTimes(1);
  });

  it("blocks without retrying when aif-fix itself fails", async () => {
    testDb.current
      .insert(tasks)
      .values({
        id: "task-fix-error",
        projectId: "project-1",
        title: "Task",
        description: "Desc",
        status: "verify",
      })
      .run();

    executeSubagentQueryMock
      .mockResolvedValueOnce({
        resultText:
          'Verification failed\n\n```aif-gate-result\n{"status":"fail","blocking":true,"suggested_next":{"command":"/aif-fix"}}\n```',
      })
      .mockRejectedValueOnce(new Error("runtime interrupted"));

    await expect(runVerifier("task-fix-error", "/tmp/verifier-test")).rejects.toThrow(
      "Verify auto-fix failed",
    );
    expect(executeSubagentQueryMock).toHaveBeenCalledTimes(2);
  });
});
