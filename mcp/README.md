# Vowkey MCP Server

A Model Context Protocol (MCP) server that provides AI assistants with secure access to Vowkey password manager functionality through two complementary interfaces:

- **Vault Management and CLI tools** via Vowkey CLI
- **Organization Administration** via Vowkey Public API

[![npm version](https://img.shields.io/npm/v/@vowkey/mcp-server.svg)](https://www.npmjs.com/package/@vowkey/mcp-server)

> [!WARNING]
> This MCP server is designed exclusively for local use and must never be hosted publicly or exposed over a network.
>
> When you grant an AI assistant access to this server, you are providing the ability to:
>
> - Read vault items including passwords, secure notes, and sensitive data
> - Create, modify, and delete vault items
> - Access organization secrets and administrative functions
> - Expose credentials and vault contents through AI responses
>
> **You are responsible for:**
>
> - Ensuring this server runs only on your local machine or self-hosted environment
> - Understanding what data you're exposing to your AI assistant
> - Being aware that AI responses may inadvertently reveal sensitive information
> - Using appropriate AI providers (consider self-hosted or local LLMs for sensitive data)
> - Never sharing configuration files containing session tokens or API credentials
> - Monitoring logs for unexpected activity
>
> **Never:**
>
> - Deploy this server to cloud hosting, containers, or public servers
> - Share your MCP configuration files with others
> - Use this server over untrusted networks
> - Grant access to untrusted AI clients or services
>
> Use this tool responsibly and at your own risk.

## What is MCP?

The [Model Context Protocol](https://modelcontextprotocol.io/) is an open standard that enables AI assistants to securely interact with local tools and services. This server exposes Vowkey's vault management and organization administration capabilities to MCP-compatible AI clients like Claude Desktop.

## Features

### Vault Management and CLI tools (CLI)

- **Session Management**: Unlock vault via native OS password dialog, lock vault, sync with server, check status
- **Item Operations**: List, retrieve, create, edit, delete, restore vault items
  - Supports logins, secure notes, cards, and identities
  - Advanced filtering by URL, folder, collection, or trash status
- **Folder Management**: Organize items with folders
- **Attachments**: Upload, download, and manage file attachments
- **Password Tools**: Generate secure passwords and retrieve TOTP codes
- **Vowkey Send**: Create and manage secure ephemeral shares (text/file)
- **Organization Items**: Move items to organizations, manage collections
- **Device Approval**: Approve or deny new device login requests
- **Member Management**: Confirm organization member registrations

### Organization Administration (API)

- **Collections**: Create, update, delete, and manage collection permissions
- **Members**: Invite, update roles, remove members, manage group assignments
- **Groups**: Create role-based access groups and assign members
- **Policies**: Configure and enforce organization security policies
- **Audit Logs**: Retrieve organization event history
- **Subscriptions**: View and update organization billing information
- **Bulk Import**: Import users and groups from external systems

## Quick Start

### Prerequisites

**For Vault Management and CLI tools:**

- [Vowkey CLI](https://vowkey.com/help/cli/) installed (ex. `npm install -g @vowkey/cli`)
- Node.js 22+
- Vowkey account

**For Organization Administration:**

- Node.js 22+
- Vowkey Teams or Enterprise organization
- Organization owner or admin permissions

### Configuration

> [!WARNING]
> The configuration files below will contain sensitive credentials that grant access to your Vowkey vault. Keep these files secure, never commit them to version control, and never share them with others. Ensure your MCP client (e.g., Claude Desktop) is configured to run the server locally only.

#### Option 1: Claude Desktop (Recommended)

Add to your Claude Desktop configuration file:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "vowkey": {
      "command": "npx",
      "args": ["-y", "@vowkey/mcp-server"],
      "env": {
        "VOWKEY_SESSION": "your-session-token-here"
      }
    }
  }
}
```

**Get your session token:**

```bash
vowkey login
vowkey unlock --raw
```

To enable organization administration features, add API credentials:

```json
{
  "mcpServers": {
    "vowkey": {
      "command": "npx",
      "args": ["-y", "@vowkey/mcp-server"],
      "env": {
        "VOWKEY_SESSION": "your-session-token-here",
        "VOWKEY_CLIENT_ID": "organization.your-client-id",
        "VOWKEY_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

**Get organization API credentials:**

1. Go to your Vowkey Web Vault
2. Navigate to your organization → Settings → My Organization
3. Scroll to "API Key" section
4. Click "View API Key" and authenticate

#### Option 2: Locally Built and Referenced

Requires that this repository be checked out locally. Once that's done:

```bash
npm install
npm run build
```

Then reference the built `dist/index.js` file from Claude desktop:

```json
{
  "mcpServers": {
    "vowkey": {
      "command": "node",
      "args": ["local/path/to/mcp-server/dist/index.js"],
      "env": {
        "VOWKEY_SESSION": "your-session-token-here"
      }
    }
  }
}
```

#### Option 3: Other MCP Clients

Any MCP-compatible client can connect to this server via stdio transport. Refer to your client's documentation for configuration details.

### Environment Variables

| Variable                 | Required For    | Description                                                                                                                                                                                                          | Default                          |
| ------------------------ | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `VOWKEY_SESSION`             | CLI operations  | Session token from `vowkey unlock --raw`                                                                                                                                                                                 | -                                |
| `VOWKEY_CLIENT_ID`           | API operations  | Organization API client ID                                                                                                                                                                                           | -                                |
| `VOWKEY_CLIENT_SECRET`       | API operations  | Organization API client secret                                                                                                                                                                                       | -                                |
| `VOWKEY_API_BASE_URL`        | API operations  | Vowkey API base URL                                                                                                                                                                                               | `https://api.vowkey.com`      |
| `VOWKEY_IDENTITY_URL`        | API operations  | OAuth2 identity server URL                                                                                                                                                                                           | `https://identity.vowkey.com` |
| `VOWKEY_ALLOWED_DIRECTORIES` | File operations | Comma-separated list of allowed file directories. **Required** for file-based tools (e.g. `create_file_send`, `create_attachment`, `get` with `object: "attachment"`); when unset, all file operations are rejected. | -                                |
| `VOWKEY_CLI_PATH`            | CLI operations  | Absolute path to the `vowkey` executable or its JS entry point. Only needed when the CLI cannot be auto-located on `PATH` (e.g. it is not on `PATH`, or a non-standard global install layout).                           | auto-resolved from `PATH`        |

**Note:** For self-hosted Vowkey instances, set `VOWKEY_API_BASE_URL` and `VOWKEY_IDENTITY_URL` to your server URLs.

**Note:** `VOWKEY_CLIENT_ID` and `VOWKEY_CLIENT_SECRET` are the environment variable names read by the MCP server. If you are using `vowkey login --apikey` in a startup script, the Vowkey CLI reads `VOWKEY_CLIENTID` and `VOWKEY_CLIENTSECRET` (no underscores between words) for the same credentials. See the [Vowkey CLI documentation](https://vowkey.com/help/cli/#using-an-api-key).

## Usage Examples

Once configured, you can interact with Vowkey through your AI assistant:

**Vault:**

- "List all my login items"
- "Get my credentials for github"
- "Create a new secure note for my home WiFi information"
- "Generate a 32-character password and save it for apple.com"
- "Create a Send link for this file"

**Organization Administration:**

- "List all members in my organization"
- "Invite user@example.com as an organization admin"
- "Create a 'Development Team' collection"
- "Show me the last 100 audit log events"
- "What security policies are enabled?"

## Available Tools

### Vault Management and CLI Tools

- **Session**: `lock`, `unlock`, `sync`, `status`
- **Retrieval**: `list`, `get`
- **Items**: `create_item`, `edit_item`, `delete`, `restore`
- **Folders**: `create_folder`, `edit_folder`
- **Attachments**: `create_attachment`
- **Organizations**: `create_org_collection`, `edit_org_collection`, `edit_item_collections`, `move`, `confirm`
- **Device Approval**: `device_approval_list`, `device_approval_approve`, `device_approval_approve_all`, `device_approval_deny`, `device_approval_deny_all`
- **Send**: `create_text_send`, `create_file_send`, `list_send`, `get_send`, `edit_send`, `delete_send`, `remove_send_password`
- **Utilities**: `generate`

### Organization Administration

- **Collections**: `list_org_collections`, `get_org_collection`, `update_org_collection`, `delete_org_collection`
- **Members**: `list_org_members`, `get_org_member`, `invite_org_member`, `update_org_member`, `remove_org_member`, `reinvite_org_member`, `get_org_member_groups`, `update_org_member_groups`
- **Groups**: `list_org_groups`, `get_org_group`, `create_org_group`, `update_org_group`, `delete_org_group`, `get_org_group_members`, `update_org_group_members`
- **Policies**: `list_org_policies`, `get_org_policy`, `update_org_policy`
- **Events**: `get_org_events`
- **Subscriptions**: `get_org_subscription`, `update_org_subscription`
- **Import**: `import_org_users_and_groups`

## Development

### Setup

```bash
git clone https://github.com/vowkey/vowkey-core.git
cd vowkey-core/mcp
npm install
```

### Commands

```bash
npm run build        # Compile TypeScript
npm test             # Run test suite
npm run lint         # Check code style
npm run lint:fix     # Auto-fix linting issues
npm run inspect      # Test with MCP Inspector
```

### Testing with MCP Inspector

The MCP Inspector provides an interactive testing environment:

```bash
npm run build
npm run inspect
```

This opens a web interface where you can:

- Browse available tools
- Test tool execution with custom inputs
- View request/response payloads
- Debug tool behavior

### Best Practices

- Store credentials securely (use system keychains or environment managers)
- Rotate session tokens regularly
- Review audit logs periodically for suspicious activity
- Never commit credentials to version control

### Testing

The project includes Jest unit tests covering validation, CLI commands, and core functionality.

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm test -- --coverage

# Run specific test file
npm test validation.spec.ts

# Run tests matching a pattern
npm test -- --testNamePattern="validation"
```

### Debugging

**Enable debug logging** by setting environment variables:

```bash
export DEBUG=vowkey:*
export NODE_ENV=development
```

## Security Considerations

- **Never commit** sensitive credentials (`VOWKEY_SESSION`, `VOWKEY_CLIENT_ID`, `VOWKEY_CLIENT_SECRET`)
- **Use environment variables** for all sensitive configuration
- **Validate all inputs** using Zod schemas (already implemented)
- **Test with non-production data** when possible
- **Monitor API usage** through your organization's audit logs
- Understand the security and privacy impacts of exposing sensitive vault data to LLM and AI tools. Using a self-hosted or local LLM may be appropriate, for example.

## Troubleshooting

### CLI Issues

- **Vault is locked**
  - Ask your AI assistant to run the `unlock` tool — the MCP server will open a native OS password dialog for you to enter your master password. The password is never sent through the MCP protocol or seen by the LLM.
  - On headless machines (no `DISPLAY` on Linux, no GUI session), the `unlock` tool will refuse to run. Use the manual fallback:

    ```bash
    vowkey unlock --raw
    # Copy the token and update VOWKEY_SESSION in your MCP config
    ```

- **Session key is invalid**
  - Session tokens expire after inactivity
  - Ask your AI assistant to run the `unlock` tool to refresh the session in-place, or run `vowkey unlock --raw` manually and update your MCP configuration with the new token

### Unlocking the vault interactively

The `unlock` tool lets your AI assistant prompt you for your master password without that password ever crossing the MCP channel.

- The tool takes **no input parameters**. It cannot be invoked with a password argument.
- When called, the server launches a **native OS password dialog**:
  - **macOS**: `osascript` secure input dialog
  - **Linux**: `zenity --password` (falls back to `kdialog --password`)
  - **Windows**: PowerShell WinForms password dialog (masked input)
- The password is passed to `vowkey unlock --raw` via the `--passwordenv` flag with a randomized one-shot environment variable. It never appears in process arguments, in the MCP protocol, or in the LLM's context.
- The LLM only ever sees `"Vault unlocked successfully."` or a sanitized failure message (e.g. `"Invalid master password."`, `"Unlock cancelled."`).
- If you are in a non-interactive environment, the tool will refuse to run and return a fixed message directing you to the `vowkey unlock --raw` manual flow.

### API Issues

- **Invalid client credentials**
  - Verify `VOWKEY_CLIENT_ID` starts with `organization.`
  - Ensure `VOWKEY_CLIENT_SECRET` is correct
  - Check that API keys haven't been rotated in the Admin Console

- **403 Forbidden**
  - Verify you have organization owner or admin permissions
  - Some operations require specific roles (e.g., managing members)

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](https://contributing.vowkey.com/) for guidelines.
