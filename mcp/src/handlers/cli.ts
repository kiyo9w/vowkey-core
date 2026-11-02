/**
 * CLI command handlers for personal vault operations
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { executeCliCommand } from '../utils/cli.js';
import { resolveAgentEndpoint } from '../utils/agent-discovery.js';
import { runUnlockFlow } from '../utils/unlock.js';
import { withValidation } from '../utils/validation.js';
import {
  lockSchema,
  unlockSchema,
  syncSchema,
  statusSchema,
  listSchema,
  getSchema,
  generateSchema,
  createItemSchema,
  createFolderSchema,
  editItemSchema,
  editFolderSchema,
  deleteSchema,
  confirmSchema,
  createOrgCollectionSchema,
  editOrgCollectionSchema,
  editItemCollectionsSchema,
  moveSchema,
  deviceApprovalListSchema,
  deviceApprovalApproveSchema,
  deviceApprovalApproveAllSchema,
  deviceApprovalDenySchema,
  deviceApprovalDenyAllSchema,
  restoreSchema,
  createTextSendSchema,
  createFileSendSchema,
  listSendSchema,
  getSendSchema,
  editSendSchema,
  deleteSendSchema,
  removeSendPasswordSchema,
  createAttachmentSchema,
  listReferencesSchema,
  pairAgentSchema,
  readFormSchema,
  fillFormSchema,
  requestAccessSchema,
  accessResultSchema,
  syncEnvFileSchema,
  proxyStatusSchema,
} from '../schemas/cli.js';
import {
  accessRequestAssignments,
  extractReferenceDescriptors,
  formatVkReference,
  parseVkReference,
  redactCliOutputToReferences,
  redactItemOutput,
  redactSendOutput,
  resolveVkFieldOnRawItem,
  scrubErrorOutput,
  validateAccessRequestV1Alpha2,
} from '../utils/references.js';
import {
  CliResponse,
  VowkeyItem,
  VowkeyFolder,
  VowkeySend,
} from '../utils/types.js';

function toMcpFormat(response: CliResponse) {
  const safeError = response.errorOutput
    ? scrubErrorOutput(response.errorOutput)
    : undefined;
  return {
    isError: response.errorOutput ? true : false,
    content: [
      {
        type: 'text',
        text: response.output || safeError || 'Success: Operation completed',
      },
    ],
  };
}

export const handleLock = withValidation(lockSchema, async () => {
  // Clear the in-memory session before running `vowkey lock`. The intent of
  // calling `lock` is "I want the session gone" — clearing up-front
  // means we never leave a stale VOWKEY_SESSION in process.env if `vowkey lock`
  // writes benign stderr on success (which would have looked like a
  // failure to the previous conditional-clear).
  delete process.env['VOWKEY_SESSION'];
  const response = await executeCliCommand('lock', []);
  return toMcpFormat(response);
});

export const handleUnlock = withValidation(unlockSchema, async () => {
  const result = await runUnlockFlow();
  return {
    isError: !result.success,
    content: [
      {
        type: 'text' as const,
        text: result.success ? result.message : result.error,
      },
    ],
  };
});

export const handleSync = withValidation(syncSchema, async () => {
  const response = await executeCliCommand('sync', []);
  return toMcpFormat(response);
});

export const handleStatus = withValidation(statusSchema, async () => {
  const response = await executeCliCommand('status', []);
  return toMcpFormat(response);
});

export const handleList = withValidation(listSchema, async (validatedArgs) => {
  const { type, search, organizationid, url, folderid, collectionid, trash } =
    validatedArgs;
  const params: string[] = [type];
  if (search) {
    params.push('--search', search);
  }
  if (organizationid) {
    params.push('--organizationid', organizationid);
  }
  if (url) {
    params.push('--url', url);
  }
  if (folderid) {
    params.push('--folderid', folderid);
  }
  if (collectionid) {
    params.push('--collectionid', collectionid);
  }
  if (trash) {
    params.push('--trash');
  }
  const response = await executeCliCommand('list', params);
  if (response.output) {
    response.output =
      type === 'items'
        ? redactItemOutput(response.output)
        : redactCliOutputToReferences(response.output, type);
  }
  return toMcpFormat(response);
});

export const handleGet = withValidation(getSchema, async (validatedArgs) => {
  const { object, id, organizationid, itemid, output } = validatedArgs;
  const params: string[] = [object, id];
  if (organizationid) {
    params.push('--organizationid', organizationid);
  }
  if (itemid) {
    params.push('--itemid', itemid);
  }
  if (output) {
    params.push('--output', output);
  }
  const response = await executeCliCommand('get', params);
  if (!response.errorOutput && object === 'attachment') {
    const ownerItemId = itemid || 'item';
    response.output = JSON.stringify({
      object: 'attachment',
      itemId: ownerItemId,
      attachment: id,
      outputPath: output ?? null,
      saved: true,
      reference: formatVkReference(ownerItemId, `attachment.${id}`),
    });
    return toMcpFormat(response);
  }
  if (response.output) {
    response.output =
      object === 'item'
        ? redactItemOutput(response.output)
        : redactCliOutputToReferences(response.output, object, id);
  }
  return toMcpFormat(response);
});

export const handleGenerate = withValidation(
  generateSchema,
  async (validatedArgs) => {
    const params: string[] = [];

    if (validatedArgs.passphrase) {
      params.push('--passphrase');
      if (validatedArgs.words) {
        params.push('--words', validatedArgs.words.toString());
      }
      if (validatedArgs.separator) {
        params.push('--separator', validatedArgs.separator);
      }
      if (validatedArgs.capitalize) {
        params.push('--capitalize');
      }
    } else {
      if (validatedArgs.length) {
        params.push('--length', validatedArgs.length.toString());
      }
      if (validatedArgs.uppercase === false) {
        params.push('--noUppercase');
      }
      if (validatedArgs.lowercase === false) {
        params.push('--noLowercase');
      }
      if (validatedArgs.number === false) {
        params.push('--noNumbers');
      }
      if (validatedArgs.special === false) {
        params.push('--noSpecial');
      }
    }

    const response = await executeCliCommand('generate', params);
    if (response.errorOutput) {
      return toMcpFormat({ errorOutput: response.errorOutput });
    }

    const secret = (response.output ?? '').trim();
    if (!secret) {
      return toMcpFormat({
        errorOutput: 'unavailable: Failed to generate secret.',
      });
    }

    const kind = validatedArgs.passphrase ? 'passphrase' : 'password';
    const preview = '••••••••••••';

    // Option 1: Rotate password directly inside an existing vault login item
    if (validatedArgs.itemId) {
      const getRes = await executeCliCommand('get', [
        'item',
        validatedArgs.itemId,
      ]);
      if (getRes.errorOutput) {
        return toMcpFormat({ errorOutput: getRes.errorOutput });
      }
      try {
        const existingItem = JSON.parse(getRes.output || '{}') as VowkeyItem;
        existingItem.login = {
          ...(existingItem.login || {}),
          password: secret,
        };
        const encoded = Buffer.from(JSON.stringify(existingItem)).toString(
          'base64',
        );
        const editRes = await executeCliCommand('edit', [
          'item',
          validatedArgs.itemId,
          encoded,
        ]);
        if (editRes.errorOutput) {
          return toMcpFormat({ errorOutput: editRes.errorOutput });
        }
        return {
          isError: false,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                itemId: validatedArgs.itemId,
                updated: true,
                kind,
                length: secret.length,
                preview,
                reference: formatVkReference(
                  validatedArgs.itemId,
                  'login.password',
                ),
              }),
            },
          ],
        };
      } catch {
        return toMcpFormat({
          errorOutput: 'unavailable: Failed to update target vault item.',
        });
      }
    }

    // Option 2: Create a new vault login item (explicitly named or best-effort default)
    const targetName = validatedArgs.saveAsName || 'Generated login';
    const loginPayload: VowkeyItem['login'] = {
      password: secret,
      ...(validatedArgs.username ? { username: validatedArgs.username } : {}),
      ...(validatedArgs.uri ? { uris: [{ uri: validatedArgs.uri }] } : {}),
    };
    const newItem: VowkeyItem = {
      name: targetName,
      type: 1,
      login: loginPayload,
    };
    const encodedNew = Buffer.from(JSON.stringify(newItem)).toString('base64');
    const createRes = await executeCliCommand('create', ['item', encodedNew]);
    if (!createRes.errorOutput && createRes.output) {
      try {
        const created = JSON.parse(createRes.output) as Record<string, unknown>;
        const createdId =
          typeof created['id'] === 'string' && created['id']
            ? created['id']
            : null;
        if (createdId) {
          return {
            isError: false,
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  itemId: createdId,
                  name: targetName,
                  created: true,
                  kind,
                  length: secret.length,
                  preview,
                  reference: formatVkReference(createdId, 'login.password'),
                }),
              },
            ],
          };
        }
      } catch {
        // Fall through to masked handle when create output is non-JSON in offline stubs
      }
    }

    if (validatedArgs.saveAsName && createRes.errorOutput) {
      return toMcpFormat({ errorOutput: createRes.errorOutput });
    }

    // Standalone fallback: return masked preview + opaque @vk: handle, never raw secret bytes
    const handleId = `generated-${crypto.randomUUID().slice(0, 8)}`;
    return {
      isError: false,
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            generated: true,
            storedInVault: false,
            kind,
            length: secret.length,
            preview,
            reference: formatVkReference(handleId, 'login.password'),
          }),
        },
      ],
    };
  },
);

export const handleCreateItem = withValidation(
  createItemSchema,
  async (validatedArgs) => {
    const { name, type, notes, login, card, identity, secureNote, folderId } =
      validatedArgs;

    // Creating an item with the specified type
    const item: VowkeyItem = {
      name,
      type,
    };

    if (notes !== undefined) {
      item.notes = notes;
    }

    if (folderId !== undefined) {
      item.folderId = folderId;
    }

    // Set type-specific data based on item type
    if (type === 1 && login) {
      // Login type
      const loginData: VowkeyItem['login'] = {};
      if (login.username !== undefined) loginData.username = login.username;
      if (login.password !== undefined) loginData.password = login.password;
      if (login.totp !== undefined) loginData.totp = login.totp;
      if (login.uris !== undefined) loginData.uris = login.uris;
      item.login = loginData;
    } else if (type === 2 && secureNote) {
      // Secure Note type
      const secureNoteData: VowkeyItem['secureNote'] = {};
      if (secureNote.type !== undefined) secureNoteData.type = secureNote.type;
      item.secureNote = secureNoteData;
    } else if (type === 3 && card) {
      // Card type
      const cardData: VowkeyItem['card'] = {};
      if (card.cardholderName !== undefined)
        cardData.cardholderName = card.cardholderName;
      if (card.number !== undefined) cardData.number = card.number;
      if (card.brand !== undefined) cardData.brand = card.brand;
      if (card.expMonth !== undefined) cardData.expMonth = card.expMonth;
      if (card.expYear !== undefined) cardData.expYear = card.expYear;
      if (card.code !== undefined) cardData.code = card.code;
      item.card = cardData;
    } else if (type === 4 && identity) {
      // Identity type
      const identityData: VowkeyItem['identity'] = {};
      if (identity.title !== undefined) identityData.title = identity.title;
      if (identity.firstName !== undefined)
        identityData.firstName = identity.firstName;
      if (identity.middleName !== undefined)
        identityData.middleName = identity.middleName;
      if (identity.lastName !== undefined)
        identityData.lastName = identity.lastName;
      if (identity.address1 !== undefined)
        identityData.address1 = identity.address1;
      if (identity.address2 !== undefined)
        identityData.address2 = identity.address2;
      if (identity.address3 !== undefined)
        identityData.address3 = identity.address3;
      if (identity.city !== undefined) identityData.city = identity.city;
      if (identity.state !== undefined) identityData.state = identity.state;
      if (identity.postalCode !== undefined)
        identityData.postalCode = identity.postalCode;
      if (identity.country !== undefined)
        identityData.country = identity.country;
      if (identity.company !== undefined)
        identityData.company = identity.company;
      if (identity.email !== undefined) identityData.email = identity.email;
      if (identity.phone !== undefined) identityData.phone = identity.phone;
      if (identity.ssn !== undefined) identityData.ssn = identity.ssn;
      if (identity.username !== undefined)
        identityData.username = identity.username;
      if (identity.passportNumber !== undefined)
        identityData.passportNumber = identity.passportNumber;
      if (identity.licenseNumber !== undefined)
        identityData.licenseNumber = identity.licenseNumber;
      item.identity = identityData;
    }

    const itemJson = JSON.stringify(item);
    const encodedItem = Buffer.from(itemJson).toString('base64');
    const response = await executeCliCommand('create', ['item', encodedItem]);
    if (response.output) {
      response.output = redactItemOutput(response.output);
    }
    return toMcpFormat(response);
  },
);

export const handleCreateFolder = withValidation(
  createFolderSchema,
  async (validatedArgs) => {
    const { name } = validatedArgs;

    const folder: VowkeyFolder = { name };
    const itemJson = JSON.stringify(folder);
    const encodedItem = Buffer.from(itemJson).toString('base64');
    const response = await executeCliCommand('create', ['folder', encodedItem]);
    return toMcpFormat(response);
  },
);

export const handleEditItem = withValidation(
  editItemSchema,
  async (validatedArgs) => {
    const { id, name, notes, login, card, identity, secureNote, folderId } =
      validatedArgs;

    // First, get the existing item
    const getResponse = await executeCliCommand('get', ['item', id]);

    if (getResponse.errorOutput) {
      return toMcpFormat(getResponse);
    }

    try {
      // Parse the existing item with proper typing
      const existingItem: VowkeyItem = JSON.parse(getResponse.output || '{}');

      // Only update properties that were provided
      if (name !== undefined) existingItem.name = name;
      if (notes !== undefined) existingItem.notes = notes;
      if (folderId !== undefined) existingItem.folderId = folderId;

      // Update type-specific data
      if (login !== undefined) {
        // Merge login properties with existing login data
        const currentLogin = existingItem.login || {};
        const updatedLogin: VowkeyItem['login'] = {
          ...currentLogin,
          ...(login.username !== undefined && { username: login.username }),
          ...(login.password !== undefined && { password: login.password }),
          ...(login.totp !== undefined && { totp: login.totp }),
          ...(login.uris !== undefined && { uris: login.uris }),
        };
        existingItem.login = updatedLogin;
      }

      if (card !== undefined) {
        // Merge card properties with existing card data
        const currentCard = existingItem.card || {};
        const updatedCard: VowkeyItem['card'] = {
          ...currentCard,
          ...(card.cardholderName !== undefined && {
            cardholderName: card.cardholderName,
          }),
          ...(card.number !== undefined && { number: card.number }),
          ...(card.brand !== undefined && { brand: card.brand }),
          ...(card.expMonth !== undefined && { expMonth: card.expMonth }),
          ...(card.expYear !== undefined && { expYear: card.expYear }),
          ...(card.code !== undefined && { code: card.code }),
        };
        existingItem.card = updatedCard;
      }

      if (identity !== undefined) {
        // Merge identity properties with existing identity data
        const currentIdentity = existingItem.identity || {};
        const updatedIdentity: VowkeyItem['identity'] = {
          ...currentIdentity,
          ...(identity.title !== undefined && { title: identity.title }),
          ...(identity.firstName !== undefined && {
            firstName: identity.firstName,
          }),
          ...(identity.middleName !== undefined && {
            middleName: identity.middleName,
          }),
          ...(identity.lastName !== undefined && {
            lastName: identity.lastName,
          }),
          ...(identity.address1 !== undefined && {
            address1: identity.address1,
          }),
          ...(identity.address2 !== undefined && {
            address2: identity.address2,
          }),
          ...(identity.address3 !== undefined && {
            address3: identity.address3,
          }),
          ...(identity.city !== undefined && { city: identity.city }),
          ...(identity.state !== undefined && { state: identity.state }),
          ...(identity.postalCode !== undefined && {
            postalCode: identity.postalCode,
          }),
          ...(identity.country !== undefined && { country: identity.country }),
          ...(identity.company !== undefined && { company: identity.company }),
          ...(identity.email !== undefined && { email: identity.email }),
          ...(identity.phone !== undefined && { phone: identity.phone }),
          ...(identity.ssn !== undefined && { ssn: identity.ssn }),
          ...(identity.username !== undefined && {
            username: identity.username,
          }),
          ...(identity.passportNumber !== undefined && {
            passportNumber: identity.passportNumber,
          }),
          ...(identity.licenseNumber !== undefined && {
            licenseNumber: identity.licenseNumber,
          }),
        };
        existingItem.identity = updatedIdentity;
      }

      if (secureNote !== undefined) {
        // Merge secure note properties with existing secure note data
        const currentSecureNote = existingItem.secureNote || {};
        const updatedSecureNote: VowkeyItem['secureNote'] = {
          ...currentSecureNote,
          ...(secureNote.type !== undefined && { type: secureNote.type }),
        };
        existingItem.secureNote = updatedSecureNote;
      }

      const updatesJson = JSON.stringify(existingItem);
      const encodedUpdates = Buffer.from(updatesJson).toString('base64');
      const response = await executeCliCommand('edit', [
        'item',
        id,
        encodedUpdates,
      ]);
      if (response.output) {
        response.output = redactItemOutput(response.output);
      }
      return toMcpFormat(response);
    } catch (error) {
      const errorResponse: CliResponse = {
        errorOutput: `Failed to parse existing item: ${error instanceof Error ? error.message : String(error)}`,
      };
      return toMcpFormat(errorResponse);
    }
  },
);

export const handleEditFolder = withValidation(
  editFolderSchema,
  async (validatedArgs) => {
    const { id, name } = validatedArgs;

    const folder: VowkeyFolder = { name };
    const itemJson = JSON.stringify(folder);
    const encodedItem = Buffer.from(itemJson).toString('base64');
    const response = await executeCliCommand('edit', [
      'folder',
      id,
      encodedItem,
    ]);
    return toMcpFormat(response);
  },
);

export const handleDelete = withValidation(
  deleteSchema,
  async (validatedArgs) => {
    const { object, id, permanent } = validatedArgs;
    const params: string[] = [object, id];
    if (permanent) {
      params.push('--permanent');
    }
    const response = await executeCliCommand('delete', params);
    return toMcpFormat(response);
  },
);

export const handleConfirm = withValidation(
  confirmSchema,
  async (validatedArgs) => {
    const { organizationId, memberId } = validatedArgs;
    const response = await executeCliCommand('confirm', [
      'org-member',
      memberId,
      '--organizationid',
      organizationId,
    ]);
    return toMcpFormat(response);
  },
);

export const handleCreateOrgCollection = withValidation(
  createOrgCollectionSchema,
  async (validatedArgs) => {
    const { organizationId, name, externalId, groups } = validatedArgs;

    // Build the collection object
    const collection: Record<string, unknown> = {
      organizationId,
      name,
    };

    if (externalId) {
      collection['externalId'] = externalId;
    }

    if (groups && groups.length > 0) {
      collection['groups'] = groups;
    }

    // Encode the JSON as base64
    const collectionJson = JSON.stringify(collection);
    const encodedJson = Buffer.from(collectionJson, 'utf8').toString('base64');

    // Build the command
    const response = await executeCliCommand('create', [
      'org-collection',
      encodedJson,
      '--organizationid',
      organizationId,
    ]);
    return toMcpFormat(response);
  },
);

export const handleEditOrgCollection = withValidation(
  editOrgCollectionSchema,
  async (validatedArgs) => {
    const { organizationId, collectionId, name, externalId, groups } =
      validatedArgs;

    // First, get the existing collection
    const getResponse = await executeCliCommand('get', [
      'org-collection',
      collectionId,
      '--organizationid',
      organizationId,
    ]);

    if (getResponse.errorOutput) {
      return toMcpFormat(getResponse);
    }

    // Parse the existing collection
    let collection: Record<string, unknown>;
    try {
      collection = JSON.parse(getResponse.output || '{}');
    } catch {
      const errorResponse: CliResponse = {
        output: '',
        errorOutput: 'Failed to parse existing collection data',
      };
      return toMcpFormat(errorResponse);
    }

    // Update with new values
    if (name !== undefined) {
      collection['name'] = name;
    }
    if (externalId !== undefined) {
      collection['externalId'] = externalId;
    }
    if (groups !== undefined) {
      collection['groups'] = groups;
    }

    // Ensure organizationId is set
    collection['organizationId'] = organizationId;

    // Encode the JSON as base64
    const collectionJson = JSON.stringify(collection);
    const encodedJson = Buffer.from(collectionJson, 'utf8').toString('base64');

    // Build the command
    const response = await executeCliCommand('edit', [
      'org-collection',
      collectionId,
      encodedJson,
      '--organizationid',
      organizationId,
    ]);
    return toMcpFormat(response);
  },
);

export const handleEditItemCollections = withValidation(
  editItemCollectionsSchema,
  async (validatedArgs) => {
    const { itemId, organizationId, collectionIds } = validatedArgs;

    // Encode the collection IDs array as JSON
    const collectionIdsJson = JSON.stringify(collectionIds);
    const encodedJson = Buffer.from(collectionIdsJson, 'utf8').toString(
      'base64',
    );

    // Build the command
    const response = await executeCliCommand('edit', [
      'item-collections',
      itemId,
      encodedJson,
      '--organizationid',
      organizationId,
    ]);
    return toMcpFormat(response);
  },
);

/**
 * Handles moving (sharing) a vault item to an organization.
 *
 * @param {Record<string, unknown>} args - Arguments from the tool call.
 * @returns {Promise<McpResponse>} Promise resolving to the formatted result.
 */
export const handleMove = withValidation(
  moveSchema,
  async ({ itemId, organizationId, collectionIds }) => {
    // Encode the collection IDs array as JSON
    const collectionIdsJson = JSON.stringify(collectionIds);
    const encodedJson = Buffer.from(collectionIdsJson, 'utf8').toString(
      'base64',
    );

    // Build the command
    const response = await executeCliCommand('move', [
      itemId,
      organizationId,
      encodedJson,
    ]);
    if (response.output) {
      response.output = redactItemOutput(response.output);
    }
    return toMcpFormat(response);
  },
);

/**
 * Handles listing pending device approval requests for an organization.
 *
 * @param {Record<string, unknown>} args - Arguments from the tool call.
 * @returns {Promise<McpResponse>} Promise resolving to the formatted result.
 */
export const handleDeviceApprovalList = withValidation(
  deviceApprovalListSchema,
  async ({ organizationId }) => {
    // Build the command
    const response = await executeCliCommand('device-approval', [
      'list',
      '--organizationid',
      organizationId,
    ]);
    return toMcpFormat(response);
  },
);

/**
 * Handles approving a pending device authorization request.
 *
 * @param {Record<string, unknown>} args - Arguments from the tool call.
 * @returns {Promise<McpResponse>} Promise resolving to the formatted result.
 */
export const handleDeviceApprovalApprove = withValidation(
  deviceApprovalApproveSchema,
  async ({ organizationId, requestId }) => {
    // Build the command
    const response = await executeCliCommand('device-approval', [
      'approve',
      '--organizationid',
      organizationId,
      requestId,
    ]);
    return toMcpFormat(response);
  },
);

/**
 * Handles approving all pending device authorization requests.
 *
 * @param {Record<string, unknown>} args - Arguments from the tool call.
 * @returns {Promise<McpResponse>} Promise resolving to the formatted result.
 */
export const handleDeviceApprovalApproveAll = withValidation(
  deviceApprovalApproveAllSchema,
  async ({ organizationId }) => {
    // Build the command
    const response = await executeCliCommand('device-approval', [
      'approve-all',
      '--organizationid',
      organizationId,
    ]);
    return toMcpFormat(response);
  },
);

/**
 * Handles denying a pending device authorization request.
 *
 * @param {Record<string, unknown>} args - Arguments from the tool call.
 * @returns {Promise<McpResponse>} Promise resolving to the formatted result.
 */
export const handleDeviceApprovalDeny = withValidation(
  deviceApprovalDenySchema,
  async ({ organizationId, requestId }) => {
    // Build the command
    const response = await executeCliCommand('device-approval', [
      'deny',
      '--organizationid',
      organizationId,
      requestId,
    ]);
    return toMcpFormat(response);
  },
);

/**
 * Handles denying all pending device authorization requests.
 *
 * @param {Record<string, unknown>} args - Arguments from the tool call.
 * @returns {Promise<McpResponse>} Promise resolving to the formatted result.
 */
export const handleDeviceApprovalDenyAll = withValidation(
  deviceApprovalDenyAllSchema,
  async ({ organizationId }) => {
    // Build the command
    const response = await executeCliCommand('device-approval', [
      'deny-all',
      '--organizationid',
      organizationId,
    ]);
    return toMcpFormat(response);
  },
);

export const handleRestore = withValidation(
  restoreSchema,
  async (validatedArgs) => {
    const { object, id } = validatedArgs;
    const response = await executeCliCommand('restore', [object, id]);
    if (response.output && object === 'item') {
      response.output = redactItemOutput(response.output);
    }
    return toMcpFormat(response);
  },
);

export const handleCreateTextSend = withValidation(
  createTextSendSchema,
  async (validatedArgs) => {
    const {
      name,
      text,
      hidden,
      notes,
      password,
      maxAccessCount,
      expirationDate,
      deletionDate,
      disabled,
    } = validatedArgs;

    // Build the Send object
    const send: VowkeySend = {
      type: 0, // Text Send
      name,
      text: {
        text,
      },
      disabled,
      deletionDate,
    };

    if (hidden !== undefined && send.text) {
      send.text.hidden = hidden;
    }

    if (notes) send.notes = notes;
    if (password) send.password = password;
    if (maxAccessCount) send.maxAccessCount = maxAccessCount;
    if (expirationDate) send.expirationDate = expirationDate;

    const sendJson = JSON.stringify(send);
    const encodedSend = Buffer.from(sendJson).toString('base64');
    const response = await executeCliCommand('send', ['create', encodedSend]);
    if (response.output) {
      response.output = redactSendOutput(response.output);
    }
    return toMcpFormat(response);
  },
);

export const handleCreateFileSend = withValidation(
  createFileSendSchema,
  async (validatedArgs) => {
    const {
      name,
      filePath,
      notes,
      password,
      maxAccessCount,
      expirationDate,
      deletionDate,
      disabled,
    } = validatedArgs;

    // Build the Send object
    const send: VowkeySend = {
      type: 1, // File Send
      name,
      disabled,
      deletionDate,
    };

    if (notes) send.notes = notes;
    if (password) send.password = password;
    if (maxAccessCount) send.maxAccessCount = maxAccessCount;
    if (expirationDate) send.expirationDate = expirationDate;

    const sendJson = JSON.stringify(send);
    const encodedSend = Buffer.from(sendJson).toString('base64');
    const response = await executeCliCommand('send', [
      'create',
      encodedSend,
      '--file',
      filePath,
    ]);
    if (response.output) {
      response.output = redactSendOutput(response.output);
    }
    return toMcpFormat(response);
  },
);

export const handleListSend = withValidation(listSendSchema, async () => {
  const response = await executeCliCommand('send', ['list']);
  if (response.output) {
    response.output = redactSendOutput(response.output);
  }
  return toMcpFormat(response);
});

export const handleGetSend = withValidation(
  getSendSchema,
  async (validatedArgs) => {
    const { id } = validatedArgs;
    const response = await executeCliCommand('send', ['get', id]);
    if (response.output) {
      response.output = redactSendOutput(response.output);
    }
    return toMcpFormat(response);
  },
);

export const handleEditSend = withValidation(
  editSendSchema,
  async (validatedArgs) => {
    const {
      id,
      name,
      notes,
      password,
      maxAccessCount,
      expirationDate,
      deletionDate,
      disabled,
    } = validatedArgs;

    // First, get the existing Send
    const getResponse = await executeCliCommand('send', ['get', id]);

    if (getResponse.errorOutput) {
      return toMcpFormat(getResponse);
    }

    try {
      // Parse the existing Send
      const existingSend: VowkeySend = JSON.parse(getResponse.output || '{}');

      // Update with new values
      if (name !== undefined) existingSend.name = name;
      if (notes !== undefined) existingSend.notes = notes;
      if (password !== undefined) existingSend.password = password;
      if (maxAccessCount !== undefined)
        existingSend.maxAccessCount = maxAccessCount;
      if (expirationDate !== undefined)
        existingSend.expirationDate = expirationDate;
      if (deletionDate !== undefined) existingSend.deletionDate = deletionDate;
      if (disabled !== undefined) existingSend.disabled = disabled;

      const updatesJson = JSON.stringify(existingSend);
      const encodedUpdates = Buffer.from(updatesJson).toString('base64');
      const response = await executeCliCommand('send', [
        'edit',
        encodedUpdates,
      ]);
      if (response.output) {
        response.output = redactSendOutput(response.output);
      }
      return toMcpFormat(response);
    } catch {
      const errorResponse: CliResponse = {
        errorOutput: 'Failed to parse existing Send.',
      };
      return toMcpFormat(errorResponse);
    }
  },
);

export const handleDeleteSend = withValidation(
  deleteSendSchema,
  async (validatedArgs) => {
    const { id } = validatedArgs;
    const response = await executeCliCommand('send', ['delete', id]);
    return toMcpFormat(response);
  },
);

export const handleRemoveSendPassword = withValidation(
  removeSendPasswordSchema,
  async (validatedArgs) => {
    const { id } = validatedArgs;
    const response = await executeCliCommand('send', ['remove-password', id]);
    if (response.output) {
      response.output = redactSendOutput(response.output);
    }
    return toMcpFormat(response);
  },
);

export const handleCreateAttachment = withValidation(
  createAttachmentSchema,
  async (validatedArgs) => {
    const { filePath, itemId } = validatedArgs;
    const response = await executeCliCommand('create', [
      'attachment',
      '--file',
      filePath,
      '--itemid',
      itemId,
    ]);
    if (response.output) {
      response.output = redactItemOutput(response.output);
    }
    return toMcpFormat(response);
  },
);

export const handleListReferences = withValidation(
  listReferencesSchema,
  async (validatedArgs) => {
    const params: string[] = ['items'];
    if (validatedArgs.search) {
      params.push('--search', validatedArgs.search);
    }
    const response = await executeCliCommand('list', params);
    if (response.errorOutput) {
      return toMcpFormat(response);
    }
    try {
      const parsed = JSON.parse(response.output || '[]');
      const items = Array.isArray(parsed)
        ? (parsed as Array<Record<string, unknown>>)
        : [];
      const descriptors = extractReferenceDescriptors(items);
      return toMcpFormat({
        output: JSON.stringify({ references: descriptors }),
      });
    } catch {
      return toMcpFormat({
        output: JSON.stringify({ references: [] }),
      });
    }
  },
);

function agentReply(value: unknown, isError: boolean) {
  return {
    isError,
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  };
}

/** Pairs this MCP client with the active Vowkey Desktop / CLI broker without manual file setup. */
export const handlePairAgent = withValidation(
  pairAgentSchema,
  async (validatedArgs) => {
    const agentName = validatedArgs.agentName?.trim() || 'Vowkey MCP Agent';
    const endpoint = resolveAgentEndpoint();
    const targetCredentialFile =
      endpoint.credentialFile ?? endpoint.defaultCredentialFile;

    try {
      fs.mkdirSync(path.dirname(targetCredentialFile), {
        recursive: true,
        mode: 0o700,
      });
    } catch {
      return agentReply(
        {
          type: 'error',
          code: 'write_failed',
          message: 'Could not prepare local pairing directory.',
        },
        true,
      );
    }

    const response = await executeCliCommand('agent', [
      'pair',
      '--credential-file',
      targetCredentialFile,
      '--name',
      agentName,
    ]);
    try {
      const parsed = JSON.parse(response.output ?? '') as Record<
        string,
        unknown
      >;
      if (parsed['type'] === 'error' || response.errorOutput) {
        return agentReply(
          {
            type: 'error',
            code: parsed['code'] ?? 'executor_unavailable',
            hint: 'Open and unlock Vowkey Desktop, then run pair_agent again.',
          },
          true,
        );
      }
      return agentReply(
        {
          type: 'paired',
          status: parsed['status'] ?? 'paired',
          pairingId: parsed['pairingId'] ?? null,
          agentName,
        },
        false,
      );
    } catch {
      return agentReply(
        {
          type: 'error',
          code: 'executor_unavailable',
          hint: 'Open and unlock Vowkey Desktop, then run pair_agent again.',
        },
        true,
      );
    }
  },
);

/** Runs `vowkey agent` and returns the broker's JSON. Auto-discovers or pairs when Desktop is live. */
async function runAgent(parameters: string[]) {
  const endpoint = resolveAgentEndpoint();
  let credentialFile = endpoint.credentialFile;

  if (credentialFile == null && endpoint.brokerLikelyAvailable) {
    try {
      fs.mkdirSync(path.dirname(endpoint.defaultCredentialFile), {
        recursive: true,
        mode: 0o700,
      });
      const pairRes = await executeCliCommand('agent', [
        'pair',
        '--credential-file',
        endpoint.defaultCredentialFile,
        '--name',
        'Vowkey MCP Agent',
      ]);
      if (
        !pairRes.errorOutput &&
        fs.existsSync(endpoint.defaultCredentialFile)
      ) {
        credentialFile = endpoint.defaultCredentialFile;
      }
    } catch {
      // Fall through to unpaired error below.
    }
  }

  if (credentialFile == null || credentialFile === '') {
    return agentReply(
      {
        type: 'error',
        code: 'unpaired',
        hint: 'Call pair_agent or unlock Vowkey Desktop to connect.',
      },
      true,
    );
  }

  const response = await executeCliCommand('agent', [
    ...parameters,
    '--credential-file',
    credentialFile,
  ]);
  const text = response.output ?? '';
  try {
    const parsed = JSON.parse(text) as { type?: string };
    return agentReply(
      parsed,
      parsed.type === 'error' || Boolean(response.errorOutput),
    );
  } catch {
    return agentReply({ type: 'error', code: 'executor_unavailable' }, true);
  }
}

function enrichFormTargetForAgent(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  if (raw['type'] !== 'form') {
    return raw;
  }
  const sections = Array.isArray(raw['sections'])
    ? (raw['sections'] as Array<Record<string, unknown>>)
    : [];
  const sectionLabels = new Map<string, string>();
  for (const sec of sections) {
    if (typeof sec['id'] === 'string' && typeof sec['label'] === 'string') {
      sectionLabels.set(sec['id'], sec['label']);
    }
  }

  const fields = Array.isArray(raw['fields'])
    ? (raw['fields'] as Array<Record<string, unknown>>).map((field) => {
        const id = typeof field['id'] === 'string' ? field['id'] : '';
        const sectionId =
          typeof field['sectionId'] === 'string' ? field['sectionId'] : null;
        const rawFormat =
          field['format'] && typeof field['format'] === 'object'
            ? (field['format'] as Record<string, unknown>)
            : {};
        const label =
          typeof field['label'] === 'string' && field['label']
            ? field['label']
            : typeof rawFormat['label'] === 'string' && rawFormat['label']
              ? rawFormat['label']
              : id;
        const options = Array.isArray(field['options'])
          ? field['options']
          : Array.isArray(rawFormat['options'])
            ? rawFormat['options']
            : undefined;
        const whose =
          sectionId && sectionLabels.has(sectionId)
            ? sectionLabels.get(sectionId)!
            : 'primary';
        const what =
          typeof field['what'] === 'string' && field['what']
            ? field['what']
            : label;
        return {
          id,
          sectionId,
          label,
          type: typeof field['type'] === 'string' ? field['type'] : 'text',
          what,
          whose,
          format: {
            label,
            ...(options && options.length > 0 ? { options } : {}),
          },
        };
      })
    : [];

  return {
    type: 'form',
    targetId: raw['targetId'] ?? null,
    kind: raw['kind'] ?? null,
    destinationKey: raw['destinationKey'] ?? null,
    generation: raw['generation'] ?? null,
    display: raw['display'] ?? null,
    formSignature: raw['formSignature'] ?? null,
    sections,
    fields,
  };
}

export const handleReadForm = withValidation(
  readFormSchema,
  async (validatedArgs) => {
    const parameters = ['read-form'];
    if (validatedArgs.targetId) {
      parameters.push('--target', validatedArgs.targetId);
    }
    const reply = await runAgent(parameters);
    if (reply.isError) {
      return reply;
    }
    try {
      const parsed = JSON.parse(reply.content[0]?.text ?? '{}') as Record<
        string,
        unknown
      >;
      return agentReply(enrichFormTargetForAgent(parsed), false);
    } catch {
      return reply;
    }
  },
);

const BROKER_MAX_ASSIGNMENTS_PER_FRAME = 5;

async function submitBatchedAssignments(options: {
  goal: string;
  reason: string;
  targetId?: string | undefined;
  assignments: Array<{ fieldId: string; reference: string }>;
}) {
  const { goal, reason, targetId, assignments } = options;
  const chunks: Array<Array<{ fieldId: string; reference: string }>> = [];
  for (
    let i = 0;
    i < assignments.length;
    i += BROKER_MAX_ASSIGNMENTS_PER_FRAME
  ) {
    chunks.push(assignments.slice(i, i + BROKER_MAX_ASSIGNMENTS_PER_FRAME));
  }

  if (chunks.length === 1) {
    const parameters = ['request', '--goal', goal, '--reason', reason];
    if (targetId) {
      parameters.push('--target', targetId);
    }
    for (const assignment of chunks[0]!) {
      parameters.push(
        '--assignment',
        `${assignment.fieldId}=${assignment.reference}`,
      );
    }
    return await runAgent(parameters);
  }

  const requestIds: string[] = [];
  const results: Array<Record<string, unknown>> = [];
  let anyPending = false;

  for (const chunk of chunks) {
    const parameters = ['request', '--goal', goal, '--reason', reason];
    if (targetId) {
      parameters.push('--target', targetId);
    }
    for (const assignment of chunk) {
      parameters.push(
        '--assignment',
        `${assignment.fieldId}=${assignment.reference}`,
      );
    }
    const batchReply = await runAgent(parameters);
    if (batchReply.isError) {
      return batchReply;
    }
    const parsed = JSON.parse(batchReply.content[0]?.text ?? '{}') as Record<
      string,
      unknown
    >;
    if (typeof parsed['requestId'] === 'string') {
      requestIds.push(parsed['requestId']);
    }
    if (parsed['status'] === 'pending_approval') {
      anyPending = true;
    }
    results.push(parsed);
  }

  return agentReply(
    {
      type: 'receipt',
      requestId: requestIds.join(','),
      requestIds,
      status: anyPending ? 'pending_approval' : 'completed',
      totalFields: assignments.length,
      batches: chunks.length,
      results,
    },
    false,
  );
}

export const handleRequestAccess = withValidation(
  requestAccessSchema,
  async (validatedArgs) => {
    const check = validateAccessRequestV1Alpha2(validatedArgs);
    if (!check.valid) {
      return {
        isError: true,
        content: [
          { type: 'text' as const, text: `Validation error: ${check.error}` },
        ],
      };
    }
    const mapped = accessRequestAssignments(validatedArgs);
    if (!mapped.ok) {
      return agentReply({ type: 'error', code: mapped.code }, true);
    }
    return await submitBatchedAssignments({
      goal: validatedArgs.goal,
      reason: validatedArgs.reason,
      targetId: validatedArgs.targetId,
      assignments: mapped.assignments,
    });
  },
);

export const handleFillForm = withValidation(
  fillFormSchema,
  async (validatedArgs) => {
    const seen = new Set<string>();
    const assignments: Array<{ fieldId: string; reference: string }> = [];
    for (const entry of validatedArgs.fields) {
      if (seen.has(entry.fieldId)) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: `Validation error: duplicate fieldId ${entry.fieldId}`,
            },
          ],
        };
      }
      seen.add(entry.fieldId);
      if (parseVkReference(entry.reference) == null) {
        return agentReply({ type: 'error', code: 'invalid_reference' }, true);
      }
      assignments.push({
        fieldId: entry.fieldId,
        reference: entry.reference.trim(),
      });
    }
    return await submitBatchedAssignments({
      goal: validatedArgs.goal,
      reason: validatedArgs.reason,
      targetId: validatedArgs.targetId,
      assignments,
    });
  },
);

export const handleAccessResult = withValidation(
  accessResultSchema,
  async (validatedArgs) => {
    const ids = validatedArgs.requestId
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length <= 1) {
      return await runAgent(['result', '--request', validatedArgs.requestId]);
    }
    const mergedFields: unknown[] = [];
    let anyPending = false;
    for (const id of ids) {
      const part = await runAgent(['result', '--request', id]);
      if (part.isError) {
        return part;
      }
      const parsed = JSON.parse(part.content[0]?.text ?? '{}') as Record<
        string,
        unknown
      >;
      if (parsed['status'] === 'pending_approval') {
        anyPending = true;
      }
      if (Array.isArray(parsed['fields'])) {
        mergedFields.push(...parsed['fields']);
      }
    }
    return agentReply(
      {
        type: 'result',
        requestId: validatedArgs.requestId,
        requestIds: ids,
        status: anyPending ? 'pending_approval' : 'completed',
        fields: mergedFields,
      },
      false,
    );
  },
);

/** Turns a failed command-line result into `{ code, message }`, with no output of its own. */
function toCodedError(response: CliResponse) {
  const text = response.errorOutput ?? '';
  const match = /(?:^|\n)([a-z]+(?:-[a-z]+)*): (.*)$/m.exec(text);
  const known = [
    'locked',
    'unavailable',
    'missing-ref',
    'refused',
    'write-failed',
    'not-listening',
    'host-ambiguous',
    'host-mismatch',
    'tls-untrusted',
    'body-not-scanned',
  ];
  const coded = match != null && known.includes(match[1] ?? '');
  const code = coded ? match![1] : 'unavailable';
  const message = coded ? match![2] : 'The request failed.';
  return {
    isError: true,
    content: [
      { type: 'text' as const, text: JSON.stringify({ code, message }) },
    ],
  };
}

function escapeDotEnvValue(raw: string): string {
  if (/^[A-Za-z0-9_./:@-]+$/.test(raw)) {
    return raw;
  }
  const escaped = raw
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
  return `"${escaped}"`;
}

export const handleSyncEnvFile = withValidation(
  syncEnvFileSchema,
  async (validatedArgs) => {
    // Mode 1: Resolve a local `.env` template containing `KEY=@vk:<itemId>/<fieldPath>` directly to disk
    if ('templatePath' in validatedArgs) {
      const { templatePath, path: targetPath } = validatedArgs;
      if (!fs.existsSync(templatePath)) {
        return toCodedError({
          errorOutput: 'refused: templatePath does not exist',
        });
      }
      const rawTemplate = fs.readFileSync(templatePath, 'utf8');
      const itemCache = new Map<string, Record<string, unknown>>();
      const outputLines: string[] = [];
      const keys: string[] = [];
      const preview: Record<string, string> = {};

      for (const line of rawTemplate.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
          outputLines.push(line);
          continue;
        }
        const eqIdx = line.indexOf('=');
        if (eqIdx <= 0) {
          outputLines.push(line);
          continue;
        }
        const envKey = line.slice(0, eqIdx).trim();
        const rawVal = line
          .slice(eqIdx + 1)
          .trim()
          .replace(/^['"]|['"]$/g, '');
        const parsedRef = parseVkReference(rawVal);
        if (!parsedRef) {
          return toCodedError({
            errorOutput: `refused: ${envKey} must reference an @vk:<itemId>/<fieldPath> handle`,
          });
        }

        let rawItem = itemCache.get(parsedRef.itemId);
        if (!rawItem) {
          const itemRes = await executeCliCommand('get', [
            'item',
            parsedRef.itemId,
          ]);
          if (itemRes.errorOutput || !itemRes.output) {
            return toCodedError({
              errorOutput: `missing-ref: could not resolve ${envKey}`,
            });
          }
          try {
            rawItem = JSON.parse(itemRes.output) as Record<string, unknown>;
            itemCache.set(parsedRef.itemId, rawItem);
          } catch {
            return toCodedError({
              errorOutput: `unavailable: invalid vault response for ${envKey}`,
            });
          }
        }

        const resolvedSecret = resolveVkFieldOnRawItem(
          rawItem,
          parsedRef.fieldPath,
        );
        if (resolvedSecret == null) {
          return toCodedError({
            errorOutput: `missing-ref: field not found for ${envKey}`,
          });
        }

        outputLines.push(`${envKey}=${escapeDotEnvValue(resolvedSecret)}`);
        keys.push(envKey);
        preview[envKey] = formatVkReference(
          parsedRef.itemId,
          parsedRef.fieldPath,
        );
      }

      try {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, outputLines.join('\n') + '\n', {
          encoding: 'utf8',
          mode: 0o600,
        });
      } catch {
        return toCodedError({
          errorOutput: 'write-failed: could not write target .env file',
        });
      }

      return {
        isError: false,
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              synced: keys.length,
              keys,
              path: targetPath,
              state: 'written',
              preview,
            }),
          },
        ],
      };
    }

    // Mode 2: Managed environment item via `vowkey env file`
    const { environmentId, path: targetPath, enabled } = validatedArgs;
    const response = await executeCliCommand(
      'env',
      enabled
        ? [
            'file',
            '--environment',
            environmentId,
            '--path',
            targetPath,
            '--enable',
          ]
        : ['file', '--environment', environmentId, '--disable'],
    );
    if (response.errorOutput) {
      return toCodedError(response);
    }
    try {
      const parsed = JSON.parse(response.output ?? '') as Record<
        string,
        unknown
      >;
      const keys: string[] = [];
      const preview: Record<string, string> = {};
      if (enabled) {
        const refRes = await executeCliCommand('env', [
          'references',
          '--environment',
          environmentId,
        ]);
        if (!refRes.errorOutput && refRes.output) {
          for (const line of refRes.output.split(/\r?\n/)) {
            const eq = line.indexOf('=');
            if (eq > 0) {
              const k = line.slice(0, eq).trim();
              const v = line.slice(eq + 1).trim();
              if (k && parseVkReference(v)) {
                keys.push(k);
                preview[k] = v;
              }
            }
          }
        }
      }
      const summary: Record<string, unknown> = {
        environmentId: parsed['environmentId'],
        enabled: parsed['enabled'],
        path: parsed['path'],
        state: parsed['state'],
      };
      if (keys.length > 0) {
        summary['synced'] = keys.length;
        summary['keys'] = keys;
        summary['preview'] = preview;
      }
      return {
        isError: false,
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(summary),
          },
        ],
      };
    } catch {
      return toCodedError({ errorOutput: 'unavailable: unexpected output' });
    }
  },
);

export const handleProxyStatus = withValidation(proxyStatusSchema, async () => {
  const response = await executeCliCommand('proxy', ['status']);
  if (response.errorOutput) {
    return toCodedError(response);
  }
  try {
    const parsed = JSON.parse(response.output ?? '') as Record<string, unknown>;
    return {
      isError: false,
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            listening: parsed['listening'] === true,
            host: parsed['host'],
            port: parsed['port'],
          }),
        },
      ],
    };
  } catch {
    return toCodedError({ errorOutput: 'unavailable: unexpected output' });
  }
});
