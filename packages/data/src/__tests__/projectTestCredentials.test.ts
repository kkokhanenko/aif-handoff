import { beforeEach, describe, expect, it, vi } from "vitest";
import { projects, projectTestCredentials, resetEnvCache } from "@aif/shared";
import { createTestDb } from "@aif/shared/server";

const testDb = { current: createTestDb() };
vi.mock("@aif/shared/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aif/shared/server")>();
  return { ...actual, getDb: () => testDb.current };
});

const {
  createProjectTestCredential,
  listProjectTestCredentials,
  resolveProjectTestCredentials,
  updateProjectTestCredential,
} = await import("../projectTestCredentials.js");

beforeEach(() => {
  testDb.current = createTestDb();
  testDb.current.insert(projects).values({ id: "project-1", name: "Test", rootPath: "/tmp/test" }).run();
  vi.stubEnv("AIF_PROJECT_CREDENTIALS_KEY", Buffer.alloc(32, 7).toString("base64"));
  resetEnvCache();
});

describe("project test credentials", () => {
  it("encrypts secrets at rest and only exposes metadata publicly", () => {
    const created = createProjectTestCredential("project-1", {
      name: "bitrix-test-admin",
      authType: "form",
      loginUrl: "/bitrix/admin/",
      username: "admin",
      secret: "temporary-password",
    });

    expect(created).not.toHaveProperty("secret");
    expect(listProjectTestCredentials("project-1")).toEqual([created]);
    const stored = testDb.current.select().from(projectTestCredentials).get();
    expect(stored?.secretCiphertext).not.toContain("temporary-password");
    expect(resolveProjectTestCredentials("project-1")).toEqual([{ ref: "bitrix-test-admin", authType: "form", loginUrl: "/bitrix/admin/", username: "admin", password: "temporary-password" }]);
  });

  it("retains the encrypted secret when metadata is updated", () => {
    const created = createProjectTestCredential("project-1", {
      name: "site-admin", authType: "form", username: "old", secret: "secret",
    });
    updateProjectTestCredential("project-1", created.id, { username: "new" });
    expect(resolveProjectTestCredentials("project-1")[0]).toMatchObject({ username: "new", password: "secret" });
  });
});
