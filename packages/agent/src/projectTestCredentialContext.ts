import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProjectTestCredentials } from "@aif/data";

export interface ProjectTestCredentialContext {
  prompt: string;
  cleanup: () => void;
}

export function materializeProjectTestCredentialContext(
  projectId: string,
): ProjectTestCredentialContext {
  const credentials = resolveProjectTestCredentials(projectId);
  if (credentials.length === 0) return { prompt: "", cleanup: () => undefined };

  const directory = mkdtempSync(join(tmpdir(), "aif-test-credentials-"));
  chmodSync(directory, 0o700);
  const filePath = join(directory, "credentials.json");
  writeFileSync(filePath, JSON.stringify({ credentials }), { encoding: "utf8", mode: 0o600 });

  return {
    prompt: `\nProject test credentials are available at ${filePath} for this stage only. Read this file only when authentication is required. Match entries by \"ref\" (for example credential_refs from Testbench). Never print, quote, copy to artifacts, commit, or include credential values in logs/evidence.`,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}
