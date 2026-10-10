import { beforeEach, describe, expect, it, vi } from "vitest";

const readFileMock = vi.fn();
const writeFileMock = vi.fn();
const mkdirMock = vi.fn();
const homedirMock = vi.fn(() => "/home/tester");

vi.mock("node:fs/promises", () => ({
  readFile: (...args: unknown[]) => readFileMock(...args),
  writeFile: (...args: unknown[]) => writeFileMock(...args),
  mkdir: (...args: unknown[]) => mkdirMock(...args),
}));

vi.mock("node:os", () => ({
  homedir: () => homedirMock(),
}));

const { getPiMcpStatus, installPiMcpServer, uninstallPiMcpServer } =
  await import("../adapters/pi/mcp.js");

describe("Pi MCP config", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    readFileMock.mockReset();
    writeFileMock.mockReset();
    mkdirMock.mockReset();
    readFileMock.mockRejectedValue(new Error("missing"));
    writeFileMock.mockResolvedValue(undefined);
    mkdirMock.mockResolvedValue(undefined);
  });

  it("writes stdio servers to Pi's native mcp.json", async () => {
    await installPiMcpServer({
      serverName: "aif-testbench",
      command: "node",
      args: ["dist/mcp/server.js"],
      cwd: "/opt/aif-testbench/app",
      env: { LOG_LEVEL: "info" },
    });

    expect(mkdirMock).toHaveBeenCalledWith("/home/tester/.pi/agent", { recursive: true });
    expect(writeFileMock).toHaveBeenCalledTimes(1);
    const [path, content, options] = writeFileMock.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(path).toBe("/home/tester/.pi/agent/mcp.json");
    expect(options).toMatchObject({ encoding: "utf-8", mode: 0o600 });
    expect(JSON.parse(content)).toEqual({
      mcpServers: {
        "aif-testbench": {
          command: "node",
          args: ["dist/mcp/server.js"],
          cwd: "/opt/aif-testbench/app",
          env: { LOG_LEVEL: "info" },
          exposure: "direct",
        },
      },
    });
  });

  it("writes HTTP servers with a Pi environment reference for bearer auth", async () => {
    await installPiMcpServer({
      serverName: "playwright",
      transport: "streamable_http",
      url: "http://playwright-mcp:8931/mcp",
      bearerTokenEnvVar: "PLAYWRIGHT_MCP_TOKEN",
    });

    const [, content] = writeFileMock.mock.calls[0] as [string, string];
    expect(JSON.parse(content)).toEqual({
      mcpServers: {
        playwright: {
          url: "http://playwright-mcp:8931/mcp",
          exposure: "direct",
          headers: {
            Authorization: "Bearer ${PLAYWRIGHT_MCP_TOKEN}",
          },
        },
      },
    });
  });

  it("preserves unrelated Pi settings and MCP servers", async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({
        autoEnableCodemode: false,
        mcpServers: { existing: { url: "https://mcp.example.test" } },
      }),
    );

    await installPiMcpServer({
      serverName: "playwright",
      transport: "streamable_http",
      url: "http://playwright-mcp:8931/mcp",
    });

    const [, content] = writeFileMock.mock.calls[0] as [string, string];
    expect(JSON.parse(content)).toEqual({
      autoEnableCodemode: false,
      mcpServers: {
        existing: { url: "https://mcp.example.test" },
        playwright: {
          url: "http://playwright-mcp:8931/mcp",
          exposure: "direct",
        },
      },
    });
  });

  it("reads configured server status from the overridden Pi agent directory", async () => {
    vi.stubEnv("PI_CODING_AGENT_DIR", "/runtime/pi-agent");
    readFileMock.mockResolvedValue(
      JSON.stringify({ mcpServers: { playwright: { url: "http://playwright-mcp:8931/mcp" } } }),
    );

    const status = await getPiMcpStatus({ serverName: "playwright" });

    expect(readFileMock).toHaveBeenCalledWith("/runtime/pi-agent/mcp.json", "utf-8");
    expect(status).toEqual({
      installed: true,
      serverName: "playwright",
      config: { url: "http://playwright-mcp:8931/mcp" },
    });
  });

  it("removes only the requested server", async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({
        mcpServers: {
          playwright: { url: "http://playwright-mcp:8931/mcp" },
          "aif-testbench": { url: "http://aif-testbench-controller:8940/mcp" },
        },
      }),
    );

    await uninstallPiMcpServer({ serverName: "playwright" });

    const [, content] = writeFileMock.mock.calls[0] as [string, string];
    expect(JSON.parse(content)).toEqual({
      mcpServers: {
        "aif-testbench": { url: "http://aif-testbench-controller:8940/mcp" },
      },
    });
  });
});
