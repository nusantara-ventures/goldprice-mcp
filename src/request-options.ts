import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";

/** Translate GP_TIMEOUT into the SDK's per-request deadline contract. */
export function createRequestOptions(timeoutMs: number): RequestOptions {
  return { timeout: timeoutMs };
}
