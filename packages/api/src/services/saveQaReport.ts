import { execFile } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { listQaArtifacts, qaArtifactRoot } from "./qaArtifacts.js";

const execFileAsync = promisify(execFile);
const SAFE_GIT_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".json",
  ".txt",
  ".log",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
]);
const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".json", ".txt", ".log"]);

async function assertNoSecrets(root: string, paths: string[]): Promise<void> {
  const secretPatterns = [
    /-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----/,
    /authorization:\s*bearer\s+(?!\[REDACTED\])\S+/i,
    /(?:password|passwd|api[_-]?key|secret|token)\s*[=:]\s*(?!\[REDACTED\]|<redacted>)["']?[^\s"']{8,}/i,
  ];
  for (const relativePath of paths) {
    if (!TEXT_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) continue;
    const content = await readFile(path.join(root, relativePath), "utf8");
    if (secretPatterns.some((pattern) => pattern.test(content))) {
      throw new Error(`QA artifact may contain a secret and was not committed: ${relativePath}`);
    }
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 });
  return result.stdout.trim();
}

export interface SaveQaReportResult {
  branch: string;
  commit: string;
  pushed: boolean;
  excluded: string[];
}

export async function saveQaReport(input: {
  projectRoot: string;
  taskId: string;
}): Promise<SaveQaReportResult> {
  const artifacts = await listQaArtifacts(input.projectRoot, input.taskId);
  const safeArtifacts = artifacts.filter((artifact) =>
    SAFE_GIT_EXTENSIONS.has(path.extname(artifact.path).toLowerCase()),
  );
  const excluded = artifacts
    .filter((artifact) => !safeArtifacts.includes(artifact))
    .map((artifact) => artifact.path);
  if (safeArtifacts.length === 0) throw new Error("No safe QA report artifacts are available");

  const sourceRoot = qaArtifactRoot(input.projectRoot, input.taskId);
  await assertNoSecrets(
    sourceRoot,
    safeArtifacts.map((artifact) => artifact.path),
  );
  const shortId = input.taskId.slice(0, 8).toLowerCase();
  const branch = `qa/task-${shortId}-report`;
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "aif-qa-report-"));
  const worktree = path.join(temporaryRoot, "worktree");
  let worktreeAttached = false;

  try {
    const existingBranch = await git(input.projectRoot, ["branch", "--list", branch]);
    if (existingBranch) throw new Error(`QA report branch already exists: ${branch}`);
    await git(input.projectRoot, ["worktree", "add", "-b", branch, worktree, "HEAD"]);
    worktreeAttached = true;
    const destinationRoot = path.join(worktree, ".ai-factory", "qa", input.taskId);
    await mkdir(destinationRoot, { recursive: true });
    for (const artifact of safeArtifacts) {
      const destination = path.join(destinationRoot, artifact.path);
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(path.join(sourceRoot, artifact.path), destination);
    }
    const gitPath = `.ai-factory/qa/${input.taskId}`;
    await git(worktree, ["add", "--", gitPath]);
    await git(worktree, ["commit", "-m", `qa: preserve report for task ${shortId}`]);
    const commit = await git(worktree, ["rev-parse", "HEAD"]);
    let pushed = false;
    try {
      await git(worktree, ["push", "-u", "origin", branch]);
      pushed = true;
    } catch {
      // The commit remains on the local branch and can be pushed later.
    }
    return { branch, commit, pushed, excluded };
  } finally {
    if (worktreeAttached) {
      await git(input.projectRoot, ["worktree", "remove", "--force", worktree]).catch(
        () => undefined,
      );
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
