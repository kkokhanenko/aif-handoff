import { readFileSync, realpathSync, statSync } from "node:fs";
import { extname, isAbsolute, posix, relative, resolve, sep } from "node:path";

const MAX_MARKDOWN_FILE_BYTES = 1024 * 1024;
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);

export type ProjectMarkdownErrorCode =
  | "invalid_project_file_path"
  | "project_file_forbidden"
  | "project_file_not_found"
  | "project_file_too_large";

export class ProjectMarkdownError extends Error {
  constructor(
    message: string,
    readonly code: ProjectMarkdownErrorCode,
    readonly status: 400 | 403 | 404 | 413,
  ) {
    super(message);
    this.name = "ProjectMarkdownError";
  }
}

function decodeLinkPath(value: string, field: "path" | "from"): string {
  const pathOnly = value.split(/[?#]/, 1)[0]?.trim() ?? "";
  if (!pathOnly) {
    throw new ProjectMarkdownError(`Missing Markdown ${field}`, "invalid_project_file_path", 400);
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(pathOnly);
  } catch {
    throw new ProjectMarkdownError(
      `Invalid encoded Markdown ${field}`,
      "invalid_project_file_path",
      400,
    );
  }

  if (
    decoded.includes("\0") ||
    decoded.includes("\\") ||
    isAbsolute(decoded) ||
    /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(decoded) ||
    /^[a-zA-Z]:/.test(decoded)
  ) {
    throw new ProjectMarkdownError(
      `Markdown ${field} must be a relative project path`,
      "invalid_project_file_path",
      400,
    );
  }

  return decoded;
}

function assertMarkdownExtension(path: string): void {
  if (!MARKDOWN_EXTENSIONS.has(extname(path).toLowerCase())) {
    throw new ProjectMarkdownError(
      "Only Markdown project files can be opened",
      "invalid_project_file_path",
      400,
    );
  }
}

function isWithinRoot(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

export interface ProjectMarkdownDocument {
  path: string;
  content: string;
}

export function readProjectMarkdown(
  projectRoot: string,
  requestedPath: string,
  fromPath?: string,
): ProjectMarkdownDocument {
  const linkPath = decodeLinkPath(requestedPath, "path");
  const sourcePath = fromPath ? decodeLinkPath(fromPath, "from") : null;
  if (sourcePath) assertMarkdownExtension(sourcePath);

  const projectRelativePath = sourcePath
    ? posix.normalize(posix.join(posix.dirname(sourcePath), linkPath))
    : posix.normalize(linkPath);
  if (projectRelativePath === ".." || projectRelativePath.startsWith("../")) {
    throw new ProjectMarkdownError(
      "Markdown path resolves outside the project",
      "project_file_forbidden",
      403,
    );
  }
  assertMarkdownExtension(projectRelativePath);

  let realRoot: string;
  let realFile: string;
  try {
    realRoot = realpathSync(projectRoot);
    realFile = realpathSync(resolve(realRoot, projectRelativePath));
  } catch {
    throw new ProjectMarkdownError("Markdown file not found", "project_file_not_found", 404);
  }

  if (!isWithinRoot(realRoot, realFile)) {
    throw new ProjectMarkdownError(
      "Markdown path resolves outside the project",
      "project_file_forbidden",
      403,
    );
  }

  const stat = statSync(realFile);
  if (!stat.isFile()) {
    throw new ProjectMarkdownError("Markdown file not found", "project_file_not_found", 404);
  }
  if (stat.size > MAX_MARKDOWN_FILE_BYTES) {
    throw new ProjectMarkdownError(
      "Markdown file is too large to preview",
      "project_file_too_large",
      413,
    );
  }

  return {
    path: relative(realRoot, realFile).split(sep).join("/"),
    content: readFileSync(realFile, "utf8"),
  };
}
