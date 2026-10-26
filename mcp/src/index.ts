#!/usr/bin/env node

/**
 * Vowkey MCP Server - Main entry point
 *
 *
 * Features:
 * - Vault operations through the vowkey command line
 * - Input validation and sanitization
 * - Comprehensive error handling
 */

import { fileURLToPath } from 'url';
import { realpathSync } from 'fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequest,
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// Import tool definitions
import { cliTools } from './tools/index.js';

// Import handlers
import {
  handleLock,
  handleUnlock,
  handleSync,
  handleStatus,
  handleList,
  handleGet,
  handleGenerate,
  handleCreateItem,
  handleCreateFolder,
  handleEditItem,
  handleEditFolder,
  handleDelete,
  handleConfirm,
  handleCreateOrgCollection,
  handleEditOrgCollection,
  handleEditItemCollections,
  handleMove,
  handleDeviceApprovalList,
  handleDeviceApprovalApprove,
  handleDeviceApprovalApproveAll,
  handleDeviceApprovalDeny,
  handleDeviceApprovalDenyAll,
  handleRestore,
  handleCreateTextSend,
  handleCreateFileSend,
  handleListSend,
  handleGetSend,
  handleEditSend,
  handleDeleteSend,
  handleRemoveSendPassword,
  handleCreateAttachment,
} from './handlers/cli.js';


/**
 * Main server setup and execution
 */
async function runServer(): Promise<void> {
  const server = new Server(
    {
      name: 'Vowkey MCP Server',
      version: '2026.7.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // Set up tool call handler
  server.setRequestHandler(
    CallToolRequestSchema,
    async (request: CallToolRequest) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          // CLI Tools (Personal Vault Operations)
          case 'lock':
            return await handleLock(args);
          case 'unlock':
            return await handleUnlock(args);
          case 'sync':
            return await handleSync(args);
          case 'status':
            return await handleStatus(args);
          case 'list':
            return await handleList(args);
          case 'get':
            return await handleGet(args);
          case 'generate':
            return await handleGenerate(args);
          case 'create_item':
            return await handleCreateItem(args);
          case 'create_folder':
            return await handleCreateFolder(args);
          case 'edit_item':
            return await handleEditItem(args);
          case 'edit_folder':
            return await handleEditFolder(args);
          case 'delete':
            return await handleDelete(args);
          case 'confirm':
            return await handleConfirm(args);
          case 'create_org_collection':
            return await handleCreateOrgCollection(args);
          case 'edit_org_collection':
            return await handleEditOrgCollection(args);
          case 'edit_item_collections':
            return await handleEditItemCollections(args);
          case 'move':
            return await handleMove(args);
          case 'device_approval_list':
            return await handleDeviceApprovalList(args);
          case 'device_approval_approve':
            return await handleDeviceApprovalApprove(args);
          case 'device_approval_approve_all':
            return await handleDeviceApprovalApproveAll(args);
          case 'device_approval_deny':
            return await handleDeviceApprovalDeny(args);
          case 'device_approval_deny_all':
            return await handleDeviceApprovalDenyAll(args);
          case 'restore':
            return await handleRestore(args);

          // Send Tools
          case 'create_text_send':
            return await handleCreateTextSend(args);
          case 'create_file_send':
            return await handleCreateFileSend(args);
          case 'list_send':
            return await handleListSend(args);
          case 'get_send':
            return await handleGetSend(args);
          case 'edit_send':
            return await handleEditSend(args);
          case 'delete_send':
            return await handleDeleteSend(args);
          case 'remove_send_password':
            return await handleRemoveSendPassword(args);

          // Attachment Tools
          case 'create_attachment':
            return await handleCreateAttachment(args);


          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // Set up tools list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: cliTools,
    };
  });

  // Start the server
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Vowkey MCP Server running on stdio');
}

// Only run the server if this file is executed directly
// Resolve symlinks so the check works when invoked via npm bin wrapper
const isMainModule =
  process.argv[1] != null &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  runServer().catch((error) => {
    console.error('Fatal error running server:', error);
    process.exit(1);
  });
}
