import {
  RuntimeTransport,
  UsageReporting,
  type RuntimeAdapter,
  type RuntimeCapabilities,
  type RuntimeModel,
} from "../../types.js";
import { classifyPiRuntimeError } from "./errors.js";
import {
  listPiModels,
  probePiCli,
  resolvePiCliPath,
  runPiCli,
  validatePiAuth,
  type PiCliLogger,
} from "./cli.js";

const PI_CAPABILITIES: RuntimeCapabilities = {
  supportsResume: true,
  supportsSessionFork: false,
  supportsSessionList: false,
  supportsAgentDefinitions: false,
  supportsStreaming: true,
  supportsModelDiscovery: true,
  supportsApprovals: false,
  supportsCustomEndpoint: false,
  supportsIsolatedSubagentWorkflows: true,
  supportsNativeSubagentWorkflows: false,
  usageReporting: UsageReporting.FULL,
};

const FALLBACK_MODELS: RuntimeModel[] = [
  "gpt-6.1-sol",
  "gpt-6-luna",
  "gpt-6-sol",
  "gpt-6-astra",
  "gpt-5.6-sol",
  "gpt-5.6-luna",
].map((id) => ({
  id,
  label: id,
  supportsStreaming: true,
  metadata: {
    supportsEffort: true,
    supportedEffortLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
  },
}));

export interface CreatePiRuntimeAdapterOptions {
  runtimeId?: string;
  providerId?: string;
  displayName?: string;
  logger?: PiCliLogger;
}

function fallbackLogger(): PiCliLogger {
  return {
    debug: (context, message) => console.debug("[runtime:pi]", message, context),
    info: (context, message) => console.info("INFO [runtime:pi]", message, context),
    warn: (context, message) => console.warn("WARN [runtime:pi]", message, context),
    error: (context, message) => console.error("ERROR [runtime:pi]", message, context),
  };
}

export function createPiRuntimeAdapter(
  options: CreatePiRuntimeAdapterOptions = {},
): RuntimeAdapter {
  const runtimeId = options.runtimeId ?? "pi";
  const providerId = options.providerId ?? "openai-codex";
  const logger = options.logger ?? fallbackLogger();

  return {
    descriptor: {
      id: runtimeId,
      providerId,
      displayName: options.displayName ?? "Pi (OpenAI subscription)",
      description: "Pi coding agent using the OpenAI Codex OAuth subscription provider",
      defaultTransport: RuntimeTransport.CLI,
      supportedTransports: [RuntimeTransport.CLI],
      defaultModelPlaceholder: "gpt-6.1-sol",
      lightModel: "gpt-6-luna",
      skillCommandPrefix: "/",
      capabilities: PI_CAPABILITIES,
    },

    async run(input) {
      try {
        return await runPiCli({ ...input, transport: RuntimeTransport.CLI }, logger);
      } catch (error) {
        throw classifyPiRuntimeError(error);
      }
    },

    async resume(input) {
      try {
        return await runPiCli({ ...input, transport: RuntimeTransport.CLI, resume: true }, logger);
      } catch (error) {
        throw classifyPiRuntimeError(error);
      }
    },

    async validateConnection(input) {
      const cliPath = resolvePiCliPath(input.options);
      const probe = probePiCli(cliPath);
      if (!probe.ok) {
        return { ok: false, message: `Pi CLI is not reachable (${cliPath}): ${probe.error}` };
      }
      const provider =
        typeof input.options?.piProvider === "string" && input.options.piProvider.trim()
          ? input.options.piProvider.trim()
          : providerId;
      const auth = await validatePiAuth(cliPath, provider);
      return {
        ok: auth.ok,
        message: auth.ok ? `Pi ${probe.version ?? "unknown"}; ${auth.message}` : auth.message,
      };
    },

    async listModels(input) {
      const cliPath = resolvePiCliPath(input.options);
      const provider =
        typeof input.options?.piProvider === "string" && input.options.piProvider.trim()
          ? input.options.piProvider.trim()
          : providerId;
      try {
        const models = await listPiModels(cliPath, provider);
        return models.length ? models : FALLBACK_MODELS;
      } catch (error) {
        logger.warn?.(
          { runtimeId, provider, error: error instanceof Error ? error.message : String(error) },
          "Pi model discovery failed; using the built-in catalog",
        );
        return FALLBACK_MODELS;
      }
    },

    async diagnoseError(input) {
      return classifyPiRuntimeError(input.error).message;
    },
  };
}

export { PiRuntimeAdapterError } from "./errors.js";
