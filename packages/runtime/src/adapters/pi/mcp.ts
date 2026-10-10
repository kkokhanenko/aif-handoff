import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { RuntimeMcpInput, RuntimeMcpInstallInput, RuntimeMcpStatus } from "../../types.js";

interface PiMcpConfig {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

function configPath(): string {
  const configuredAgentDir = process.env.PI_CODING_AGENT_DIR?.trim();
  const agentDir = configuredAgentDir || join(homedir(), ".pi", "agent");
  return join(agentDir, "mcp.json");
}

async function readConfig(): Promise<PiMcpConfig> {
  try {
    const raw = await readFile(configPath(), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as PiMcpConfig)
      : {};
  } catch {
    return {};
  }
}

async function writeConfig(config: PiMcpConfig): Promise<void> {
  const path = configPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  });
}

function toPiServerConfig(input: RuntimeMcpInstallInput): Record<string, unknown> {
  if (input.transport === "streamable_http") {
    return {
      url: input.url,
      exposure: "direct",
      ...(input.bearerTokenEnvVar
        ? {
            headers: {
              Authorization: `Bearer \${${input.bearerTokenEnvVar}}`,
            },
          }
        : {}),
    };
  }

  return {
    command: input.command,
    ...(input.args?.length ? { args: input.args } : {}),
    ...(input.cwd ? { cwd: input.cwd } : {}),
    ...(input.env && Object.keys(input.env).length > 0 ? { env: input.env } : {}),
    exposure: "direct",
  };
}

export async function getPiMcpStatus(input: RuntimeMcpInput): Promise<RuntimeMcpStatus> {
  const config = await readConfig();
  const servers = config.mcpServers ?? {};
  const installed = input.serverName in servers;
  return {
    installed,
    serverName: input.serverName,
    config: installed ? (servers[input.serverName] as Record<string, unknown>) : null,
  };
}

export async function installPiMcpServer(input: RuntimeMcpInstallInput): Promise<void> {
  const config = await readConfig();
  config.mcpServers ??= {};
  config.mcpServers[input.serverName] = toPiServerConfig(input);
  await writeConfig(config);
}

export async function uninstallPiMcpServer(input: RuntimeMcpInput): Promise<void> {
  const config = await readConfig();
  if (!config.mcpServers || !(input.serverName in config.mcpServers)) return;
  delete config.mcpServers[input.serverName];
  await writeConfig(config);
}
