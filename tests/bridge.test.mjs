import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PACKAGE_VERSION } from "../dist/package-info.js";
import { createRequestOptions } from "../dist/request-options.js";
import { createUpstreamForwarder } from "../dist/upstream-forwarder.js";

test("runtime identity uses the package manifest version", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(PACKAGE_VERSION, packageJson.version);
});

test("GP_TIMEOUT maps to the SDK request deadline", () => {
  assert.deepEqual(createRequestOptions(12_345), { timeout: 12_345 });
});

test("every upstream call receives GP_TIMEOUT in the correct SDK position", async () => {
  const seen = {};
  const record = (method) => async (...args) => {
    seen[method] = args;
    return {};
  };
  const client = {
    connect: record("connect"),
    listTools: record("listTools"),
    callTool: record("callTool"),
    listResources: record("listResources"),
    listResourceTemplates: record("listResourceTemplates"),
    readResource: record("readResource"),
    listPrompts: record("listPrompts"),
    getPrompt: record("getPrompt"),
    complete: record("complete"),
  };
  const requestOptions = createRequestOptions(12_345);
  const upstream = createUpstreamForwarder(client, requestOptions);
  const transport = { name: "fake-transport" };
  const callToolParams = { name: "get_spot_price", arguments: { symbol: "XAU" } };
  const readResourceParams = { uri: "goldprice://docs/quickstart" };
  const getPromptParams = { name: "market_summary", arguments: {} };
  const completeParams = {
    ref: { type: "ref/prompt", name: "market_summary" },
    argument: { name: "currency", value: "US" },
  };

  await upstream.connect(transport);
  await upstream.listTools();
  await upstream.callTool(callToolParams);
  await upstream.listResources();
  await upstream.listResourceTemplates();
  await upstream.readResource(readResourceParams);
  await upstream.listPrompts();
  await upstream.getPrompt(getPromptParams);
  await upstream.complete(completeParams);

  assert.deepEqual(seen, {
    connect: [transport, requestOptions],
    listTools: [undefined, requestOptions],
    callTool: [callToolParams, undefined, requestOptions],
    listResources: [undefined, requestOptions],
    listResourceTemplates: [undefined, requestOptions],
    readResource: [readResourceParams, requestOptions],
    listPrompts: [undefined, requestOptions],
    getPrompt: [getPromptParams, requestOptions],
    complete: [completeParams, requestOptions],
  });
});
