# Vowkey MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) server that lets an AI agent work with a Vowkey vault through the `vowkey` command line, over stdio.

> [!WARNING]
> This server runs on your own machine only. Never host it publicly or expose it over a network.
>
> An agent connected to it can read vault items, including passwords, secure notes and card numbers, and can create, change and delete them. What it reads can appear in the agent's answers and in its provider's logs.
>
> Keep configuration files that contain a session key private, and connect only agents you trust.

## Tools

- **Session:** `lock`, `unlock`, `sync`, `status`
- **Items:** `list`, `get`, `create_item`, `edit_item`, `delete`, `restore`
- **Folders:** `create_folder`, `edit_folder`
- **Attachments:** `create_attachment`
- **Organizations:** `create_org_collection`, `edit_org_collection`, `edit_item_collections`, `move`, `confirm`
- **Device approval:** `device_approval_list`, `device_approval_approve`, `device_approval_approve_all`, `device_approval_deny`, `device_approval_deny_all`
- **Send:** `create_text_send`, `create_file_send`, `list_send`, `get_send`, `edit_send`, `delete_send`, `remove_send_password`
- **Utilities:** `generate`

`unlock` asks for the master password in a native dialog. The password never passes through the protocol or the agent.

## Setup

The server needs the `vowkey` command line on `PATH`, or `VOWKEY_CLI_PATH` pointing at it. Build it from `clients/`:

```sh
cd clients && npm run build:oss --workspace @vowkey/cli
```

Then log in and get a session key:

```sh
vowkey config server https://your-server
vowkey login
vowkey unlock --raw
```

Add the server to an MCP client, for example Claude Desktop:

```json
{
  "mcpServers": {
    "vowkey": {
      "command": "node",
      "args": ["/path/to/vowkey-core/mcp/dist/index.js"],
      "env": { "VOWKEY_SESSION": "the session key" }
    }
  }
}
```

## Environment variables

| Variable | Description |
| --- | --- |
| `VOWKEY_SESSION` | The session key from `vowkey unlock --raw`. |
| `VOWKEY_ALLOWED_DIRECTORIES` | Comma-separated directories that file tools may read and write (`create_file_send`, `create_attachment`, `get` with `object: "attachment"`). Required for those tools; when it is unset, every file operation is rejected. |
| `VOWKEY_CLI_PATH` | Absolute path to the `vowkey` executable or its JS entry point, when it is not on `PATH`. |

## Develop

```sh
npm install
npm run build
npm test
npm run inspect   # opens the MCP Inspector against dist/index.js
```
