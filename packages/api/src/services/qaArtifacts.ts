import { existsSync, statSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const MAX_ARTIFACTS = 500;
const QA_ROOT = ".ai-factory/qa";

export interface QaArtifactDescriptor {
  path: string;
  name: string;
  size: number;
  mimeType: string;
  kind: "markdown" | "image" | "trace" | "text" | "binary";
}

function mimeTypeFor(filePath: string): QaArtifactDescriptor["mimeType"] {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".md" || extension === ".markdown") return "text/markdown; charset=utf-8";
  if (extension === ".txt" || extension === ".log" || extension === ".json")
    return "text/plain; charset=utf-8";
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".zip") return "application/zip";
  return "application/octet-stream";
}

function kindFor(mimeType: string, filePath: string): QaArtifactDescriptor["kind"] {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("text/markdown")) return "markdown";
  if (mimeType.startsWith("text/")) return "text";
  if (filePath.endsWith("trace.zip")) return "trace";
  return "binary";
}

export function qaArtifactRoot(projectRoot: string, taskId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(taskId)) throw new Error("Invalid task id");
  return path.resolve(projectRoot, QA_ROOT, taskId);
}

export function resolveQaArtifact(
  projectRoot: string,
  taskId: string,
  relativePath: string,
): string {
  const root = qaArtifactRoot(projectRoot, taskId);
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("QA artifact path escapes task directory");
  }
  return resolved;
}

export async function listQaArtifacts(
  projectRoot: string,
  taskId: string,
): Promise<QaArtifactDescriptor[]> {
  const root = qaArtifactRoot(projectRoot, taskId);
  if (!existsSync(root)) return [];
  const result: QaArtifactDescriptor[] = [];

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (result.length >= MAX_ARTIFACTS) return;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      const mimeType = mimeTypeFor(relative);
      result.push({
        path: relative,
        name: entry.name,
        size: statSync(absolute).size,
        mimeType,
        kind: kindFor(mimeType, relative),
      });
    }
  }

  await walk(root);
  return result.sort((left, right) => left.path.localeCompare(right.path));
}

export async function readQaArtifact(
  projectRoot: string,
  taskId: string,
  relativePath: string,
): Promise<{ path: string; mimeType: string; buffer: Buffer }> {
  const absolute = resolveQaArtifact(projectRoot, taskId, relativePath);
  const stats = statSync(absolute);
  if (!stats.isFile()) throw new Error("QA artifact is not a file");
  return { path: absolute, mimeType: mimeTypeFor(relativePath), buffer: await readFile(absolute) };
}

export function qaArtifactExists(
  projectRoot: string,
  taskId: string,
  relativePath: string,
): boolean {
  try {
    return statSync(resolveQaArtifact(projectRoot, taskId, relativePath)).isFile();
  } catch {
    return false;
  }
}
