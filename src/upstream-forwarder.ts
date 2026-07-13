import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";

type UpstreamClient = Pick<
  Client,
  | "connect"
  | "listTools"
  | "callTool"
  | "listResources"
  | "listResourceTemplates"
  | "readResource"
  | "listPrompts"
  | "getPrompt"
  | "complete"
>;

/**
 * Bind every upstream MCP request to one deadline policy.
 *
 * Keeping the SDK overload positions here makes GP_TIMEOUT testable without
 * starting stdio or making a network connection.
 */
export function createUpstreamForwarder(
  client: UpstreamClient,
  requestOptions: RequestOptions,
) {
  return {
    connect: (transport: Parameters<Client["connect"]>[0]) =>
      client.connect(transport, requestOptions),
    listTools: () => client.listTools(undefined, requestOptions),
    callTool: (params: Parameters<Client["callTool"]>[0]) =>
      client.callTool(params, undefined, requestOptions),
    listResources: () => client.listResources(undefined, requestOptions),
    listResourceTemplates: () =>
      client.listResourceTemplates(undefined, requestOptions),
    readResource: (params: Parameters<Client["readResource"]>[0]) =>
      client.readResource(params, requestOptions),
    listPrompts: () => client.listPrompts(undefined, requestOptions),
    getPrompt: (params: Parameters<Client["getPrompt"]>[0]) =>
      client.getPrompt(params, requestOptions),
    complete: (params: Parameters<Client["complete"]>[0]) =>
      client.complete(params, requestOptions),
  };
}
