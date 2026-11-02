# Vowkey MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) server that lets Claude Desktop, Cursor, Codex, and any MCP client fill forms and sync developer keys by `@vk:` reference without exposing saved values in the model context.

## Connect in one step

Open Vowkey Desktop, then add `vowkey` to your MCP client:

```json
{
  "mcpServers": {
    "vowkey": {
      "command": "vowkey-mcp"
    }
  }
}
```

When running from a local checkout:

```json
{
  "mcpServers": {
    "vowkey": {
      "command": "node",
      "args": ["/path/to/vowkey-core/mcp/dist/index.js"]
    }
  }
}
```

Vowkey Desktop writes `com.vowkey.agent.json` automatically on macOS, Linux, and Windows. When an agent calls `read_form`, `fill_form`, or `pair_agent`, Vowkey discovers the local broker and prompts once in Vowkey Desktop to pair.

## Value-blind `@vk:` boundary

Every read tool (`list`, `get`, `list_references`, `list_send`, `get_send`, `generate`, `sync_env_file`, `read_form`, `fill_form`, `request_access`, `access_result`) returns item names, clean domains, outcomes, and `@vk:<itemId>/<fieldPath>` handles instead of raw passwords, API keys, card numbers, usernames, or document details. Vowkey resolves `@vk:` handles locally into the target form or `.env` file on disk.

## Key agent tools

- **Connect & inspect forms:** `pair_agent`, `read_form`, `list_references`
- **Fill forms (1 to 200 fields per batch):** `fill_form`, `request_access`, `access_result`
- **Developer keys & `.env` files:** `sync_env_file`, `proxy_status`
- **Vault management:** `unlock`, `lock`, `sync`, `status`, `list`, `get`, `generate`, `create_item`, `edit_item`, `delete`, `restore`
- **Send & attachments:** `create_text_send`, `create_file_send`, `list_send`, `get_send`, `edit_send`, `delete_send`, `remove_send_password`, `create_attachment`

## Optional environment variables

| Variable                     | Description                                                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VOWKEY_ALLOWED_DIRECTORIES` | Comma-separated directories that file tools may read and write (`sync_env_file`, `create_file_send`, `create_attachment`, `get` with `object: "attachment"`). |
| `VOWKEY_CLI_PATH`            | Absolute path to `vowkey` or its JS entry point when not on `PATH`.                                                                                           |
| `VOWKEY_AGENT_CREDENTIAL`    | Custom path for the agent pairing file (defaults to `<Vowkey CLI data>/agent/mcp-pairing.json`).                                                              |

## Develop

```sh
npm install
npm run build
npm test
npm run lint
```
