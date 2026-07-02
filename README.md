# @goldprice/mcp

Stdio bridge that wires [goldprice.dev](https://goldprice.dev)'s hosted
Model Context Protocol server into any MCP client — Claude Desktop,
Cursor, or whatever stdio-speaking agent you're using.

Thin proxy. Holds no tool logic. Forwards every JSON-RPC call to
`https://api.goldprice.dev/v1/mcp/` over the SDK's Streamable HTTP
transport, authenticated with your `GP_KEY`.

**Canonical docs and setup guide: https://goldprice.dev/docs/mcp**

---

## Install

### Claude Desktop

Edit your config file:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "goldprice": {
      "command": "npx",
      "args": ["-y", "@goldprice/mcp"],
      "env": {
        "GP_KEY": "ga_live_..."
      }
    }
  }
}
```

Fully quit Claude (Cmd-Q on macOS, not just the window close) and reopen.
The MCP icon should show `goldprice` with the tools your tier unlocks.

### Cursor

`.cursor/mcp.json` at the repo root or `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "goldprice": {
      "command": "npx",
      "args": ["-y", "@goldprice/mcp"],
      "env": { "GP_KEY": "ga_live_..." }
    }
  }
}
```

Cmd/Ctrl-Shift-P → "Restart MCP servers".

### Any other MCP client

Point it at the stdio server directly:

```sh
npx -y @goldprice/mcp
```

---

## Environment variables

| Name | Required | Default | Purpose |
|---|---|---|---|
| `GP_KEY` | yes | — | Your `ga_live_*` API key. Free tier includes MCP access. Sign up at [goldprice.dev/pricing](https://goldprice.dev/pricing). |
| `GP_BASE_URL` | no | `https://api.goldprice.dev` | Override the upstream host. Accepts root, `/v1/mcp`, or `/v1/mcp/` — the bridge normalises. Use for local-backend testing or on-prem mirrors. |
| `GP_TIMEOUT` | no | `10000` | HTTP request timeout in milliseconds. |

---

## Troubleshooting

**Claude Desktop shows "0 tools" or no `goldprice` entry.** Fully quit
Claude (Cmd-Q on macOS — closing the window leaves the process alive) and
reopen. MCP servers load once on launch. If the config JSON has a stray
trailing comma or unbalanced brace, Claude silently skips the server —
validate the JSON first.

**`invalid_api_key` or `Unauthorized` in logs.** `GP_KEY` must be set
inside the `env` block of the MCP config, not in your shell. Claude
Desktop does not inherit your terminal environment; it reads the config
file literally.

**`Forbidden` when calling a tool.** Your tier doesn't cover this tool's
data scope. The bridge surfaces the backend's plan-gate error unchanged.
See the per-tier tool list at
[goldprice.dev/docs/mcp#tools](https://goldprice.dev/docs/mcp#tools) or
upgrade at [goldprice.dev/pricing](https://goldprice.dev/pricing).

**`Rate limited` errors.** Per-minute limits are shared with REST
against the same API key. Back off and retry. Heavy agent usage
(scripted backtests in a loop) lives on Pro or Teams; interactive chat
fits in Basic.

Still stuck? Email `hello@goldprice.dev`.

---

## Local development

```sh
# from the goldprice.dev monorepo
cd packages/mcp-client
npm install
npm run build
```

Test the bridge against the live backend with a real key:

```sh
GP_KEY=ga_live_... node dist/index.js
# Then send a JSON-RPC initialize message on stdin to exercise the
# proxy, or point Claude Desktop at the local dist/ via a "command":
# "node" + "args": ["/absolute/path/to/dist/index.js"] config.
```

---

## License

MIT — see [LICENSE](./LICENSE). Copyright © 2026 Nusantara Ventures LLC.
