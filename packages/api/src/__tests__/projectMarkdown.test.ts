import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectMarkdownError, readProjectMarkdown } from "../services/projectMarkdown.js";

const temporaryRoots: string[] = [];

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), "aif-markdown-"));
  temporaryRoots.push(root);
  mkdirSync(join(root, "docs"));
  writeFileSync(join(root, "README.md"), "# Project\n");
  writeFileSync(join(root, "docs", "guide.md"), "[Home](../README.md)\n");
  return root;
}

afterEach(() => {
  while (temporaryRoots.length) rmSync(temporaryRoots.pop()!, { recursive: true, force: true });
});

describe("readProjectMarkdown", () => {
  function expectStatus(run: () => unknown, status: ProjectMarkdownError["status"]): void {
    try {
      run();
      throw new Error("Expected readProjectMarkdown to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectMarkdownError);
      expect((error as ProjectMarkdownError).status).toBe(status);
    }
  }

  it("reads a Markdown file and returns a normalized project path", () => {
    const root = makeProject();
    expect(readProjectMarkdown(root, "docs/guide.md")).toEqual({
      path: "docs/guide.md",
      content: "[Home](../README.md)\n",
    });
  });

  it("resolves nested links relative to the source document", () => {
    const root = makeProject();
    expect(readProjectMarkdown(root, "../README.md", "docs/guide.md").path).toBe("README.md");
  });

  it.each<[string, string | undefined, ProjectMarkdownError["status"]]>([
    ["../outside.md", undefined, 403],
    ["/etc/passwd.md", undefined, 400],
    ["https://example.com/readme.md", undefined, 400],
    ["package.json", undefined, 400],
  ])("rejects an unsafe or unsupported path: %s", (path, from, status) => {
    const root = makeProject();
    expectStatus(() => readProjectMarkdown(root, path, from), status);
  });

  it("blocks a Markdown symlink that escapes the project", () => {
    const root = makeProject();
    const outside = mkdtempSync(join(tmpdir(), "aif-markdown-outside-"));
    temporaryRoots.push(outside);
    writeFileSync(join(outside, "secret.md"), "secret\n");
    symlinkSync(join(outside, "secret.md"), join(root, "docs", "external.md"));

    expectStatus(() => readProjectMarkdown(root, "docs/external.md"), 403);
  });

  it("refuses oversized documents", () => {
    const root = makeProject();
    writeFileSync(join(root, "large.md"), "x".repeat(1024 * 1024 + 1));
    expectStatus(() => readProjectMarkdown(root, "large.md"), 413);
  });
});
