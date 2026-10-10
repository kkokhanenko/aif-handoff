import {
  RuntimeExecutionError,
  classifyByMessageFallback,
  type RuntimeErrorCategory,
} from "../../errors.js";

const CATEGORY_TO_CODE: Record<RuntimeErrorCategory, string> = {
  rate_limit: "PI_RATE_LIMIT",
  auth: "PI_AUTH_ERROR",
  timeout: "PI_TIMEOUT",
  permission: "PI_PERMISSION_DENIED",
  stream: "PI_STREAM_ERROR",
  transport: "PI_TRANSPORT_ERROR",
  model_not_found: "PI_MODEL_NOT_FOUND",
  context_length: "PI_CONTEXT_LENGTH",
  content_filter: "PI_CONTENT_FILTER",
  unknown: "PI_RUNTIME_ERROR",
};

export class PiRuntimeAdapterError extends RuntimeExecutionError {
  constructor(
    message: string,
    adapterCode: string,
    category: RuntimeErrorCategory,
    cause?: unknown,
  ) {
    super(message, cause, category, { adapterCode });
    this.name = "PiRuntimeAdapterError";
  }
}

export function classifyPiRuntimeError(error: unknown): PiRuntimeAdapterError {
  if (error instanceof PiRuntimeAdapterError) return error;
  if (error instanceof RuntimeExecutionError) {
    return new PiRuntimeAdapterError(
      error.message,
      CATEGORY_TO_CODE[error.category],
      error.category,
      error,
    );
  }

  const message = error instanceof Error ? error.message : String(error);
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  if (code === "ENOENT") {
    return new PiRuntimeAdapterError(message, "PI_CLI_NOT_FOUND", "transport", error);
  }

  const category = classifyByMessageFallback(message);
  return new PiRuntimeAdapterError(message, CATEGORY_TO_CODE[category], category, error);
}
