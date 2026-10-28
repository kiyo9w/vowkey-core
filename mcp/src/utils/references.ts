/**
 * Value-blind `@vk:` references and `access_request.v1alpha2` validation. Environment files,
 * `vowkey run` and the key proxy live in the command line; this file only decides what a tool
 * result may carry.
 */

export interface VkReferenceDescriptor {
  reference: string;
  itemId: string;
  itemName: string;
  fieldPath: string;
  label: string;
}

export interface AccessRequestCredentialEntry {
  entryId: string;
  reference?: string | undefined;
  keywords: string[];
  loginUrl?: string | undefined;
}

export interface AccessRequestV1Alpha2 {
  version: 'access_request.v1alpha2';
  agentId: string;
  goal: string;
  reason: string;
  requests: AccessRequestCredentialEntry[];
}

const VK_REF_REGEX = /^@vk:([^/\s]+)\/(.+)$/;

/** The name of the Hidden field that carries a profile's detail envelope or a profile link. */
export const VK_META_FIELD = 'vk.meta';

/** Item objects whose every saved string becomes a reference: SSH key, bank account, licence, passport. */
const REDACTED_OBJECTS = ['sshKey', 'bankAccount', 'driversLicense', 'passport'] as const;

/** Vowkey's own item types, which a tool result builds from an allowlist instead of redacting. */
const TYPE_API_KEY = 100;
const TYPE_ENVIRONMENT = 101;

/**
 * Formats a canonical `@vk:` reference string for an item and field path.
 */
export function formatVkReference(itemId: string, fieldPath: string): string {
  return `@vk:${itemId}/${fieldPath}`;
}

/**
 * Parses a `@vk:<itemId>/<fieldPath>` reference string.
 */
export function parseVkReference(
  ref: string,
): { itemId: string; fieldPath: string } | null {
  const match = VK_REF_REGEX.exec(ref.trim());
  if (!match || !match[1] || !match[2]) {
    return null;
  }
  return {
    itemId: match[1],
    fieldPath: match[2],
  };
}

/**
 * Replaces raw secret and profile values in a single vault item object with `@vk:` references
 * so that MCP tool results carry references and outcomes rather than raw values.
 */
export function redactItemObjectToReferences(
  item: Record<string, unknown>,
): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...item };
  const id = typeof clone['id'] === 'string' && clone['id'] ? clone['id'] : 'item';

  if (typeof clone['notes'] === 'string' && clone['notes'].length > 0) {
    clone['notes'] = formatVkReference(id, 'notes');
  }

  if (clone['login'] && typeof clone['login'] === 'object') {
    const login = { ...(clone['login'] as Record<string, unknown>) };
    if (typeof login['password'] === 'string' && login['password'].length > 0) {
      login['password'] = formatVkReference(id, 'login.password');
    }
    if (typeof login['totp'] === 'string' && login['totp'].length > 0) {
      login['totp'] = formatVkReference(id, 'login.totp');
    }
    clone['login'] = login;
  }

  if (clone['card'] && typeof clone['card'] === 'object') {
    const card = { ...(clone['card'] as Record<string, unknown>) };
    for (const key of ['number', 'code', 'cardholderName', 'expMonth', 'expYear']) {
      if (typeof card[key] === 'string' && (card[key] as string).length > 0) {
        card[key] = formatVkReference(id, `card.${key}`);
      }
    }
    clone['card'] = card;
  }

  if (clone['identity'] && typeof clone['identity'] === 'object') {
    const identity = { ...(clone['identity'] as Record<string, unknown>) };
    for (const [k, v] of Object.entries(identity)) {
      if (typeof v === 'string' && v.length > 0) {
        identity[k] = formatVkReference(id, `identity.${k}`);
      }
    }
    clone['identity'] = identity;
  }

  for (const group of REDACTED_OBJECTS) {
    if (clone[group] && typeof clone[group] === 'object') {
      const object = { ...(clone[group] as Record<string, unknown>) };
      for (const [k, v] of Object.entries(object)) {
        if (typeof v === 'string' && v.length > 0) {
          object[k] = formatVkReference(id, `${group}.${k}`);
        }
      }
      clone[group] = object;
    }
  }

  if (Array.isArray(clone['fields'])) {
    clone['fields'] = (clone['fields'] as Array<Record<string, unknown>>)
      .filter((f) => f['name'] !== VK_META_FIELD)
      .map(
      (f, idx) => {
        const fieldCopy = { ...f };
        const fname =
          typeof fieldCopy['name'] === 'string' && fieldCopy['name'].length > 0
            ? fieldCopy['name']
            : `field_${idx}`;
        if (
          typeof fieldCopy['value'] === 'string' &&
          (fieldCopy['value'] as string).length > 0
        ) {
          fieldCopy['value'] = formatVkReference(id, `field.${fname}`);
        }
        return fieldCopy;
      },
    );
  }

  return clone;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** A key item for a tool: its name, hosts and send style, and a reference where the value is. */
function projectApiKey(item: Record<string, unknown>, id: string): Record<string, unknown> {
  const source = (item['apiKey'] ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {
    id,
    name: item['name'],
    type: TYPE_API_KEY,
    organizationId: item['organizationId'] ?? null,
    collectionIds: item['collectionIds'] ?? [],
    apiKey: {
      sendStyle: source['sendStyle'],
      allowedHosts: Array.isArray(source['allowedHosts']) ? source['allowedHosts'] : [],
      headerName: source['headerName'],
      basicUsername: source['basicUsername'],
      value: formatVkReference(id, 'key.value'),
    },
  };
  if (stringOrUndefined(item['notes'])) {
    out['notes'] = formatVkReference(id, 'notes');
  }
  return out;
}

/** An environment for a tool: its members as names, item ids and references. */
function projectEnvironment(
  item: Record<string, unknown>,
  id: string,
): Record<string, unknown> {
  const source = (item['environment'] ?? {}) as Record<string, unknown>;
  const members = Array.isArray(source['members'])
    ? (source['members'] as Array<Record<string, unknown>>)
        .filter((m) => typeof m['name'] === 'string' && typeof m['itemId'] === 'string')
        .map((m) => ({
          name: m['name'],
          itemId: m['itemId'],
          reference: formatVkReference(m['itemId'] as string, 'key.value'),
        }))
    : [];
  const out: Record<string, unknown> = {
    id,
    name: item['name'],
    type: TYPE_ENVIRONMENT,
    organizationId: item['organizationId'] ?? null,
    collectionIds: item['collectionIds'] ?? [],
    environment: { members },
  };
  if (stringOrUndefined(item['notes'])) {
    out['notes'] = formatVkReference(id, 'notes');
  }
  return out;
}

/**
 * What a tool result carries for one item. Vowkey's own item types are built from an allowlist,
 * so a field the CLI adds later is left out instead of copied through; the others have each saved
 * string replaced by a reference.
 */
export function projectItem(item: Record<string, unknown>): Record<string, unknown> {
  const id = typeof item['id'] === 'string' && item['id'] ? item['id'] : 'item';
  if (item['type'] === TYPE_API_KEY) {
    return projectApiKey(item, id);
  }
  if (item['type'] === TYPE_ENVIRONMENT) {
    return projectEnvironment(item, id);
  }
  return redactItemObjectToReferences(item);
}

/**
 * Redacts the CLI's output for an item or a list of items. A body that is not JSON is never
 * passed on: the result is `{"code":"unexpected-output"}` and no raw text.
 */
export function redactItemOutput(rawOutput: string): string {
  try {
    const parsed: unknown = JSON.parse(rawOutput);
    if (Array.isArray(parsed)) {
      return JSON.stringify(
        parsed.map((entry) =>
          entry && typeof entry === 'object'
            ? projectItem(entry as Record<string, unknown>)
            : { code: 'unexpected-output' },
        ),
      );
    }
    if (parsed && typeof parsed === 'object') {
      return JSON.stringify(projectItem(parsed as Record<string, unknown>));
    }
  } catch {
    // Not JSON.
  }
  return JSON.stringify({ code: 'unexpected-output' });
}

/**
 * Redacts CLI JSON output (a single item or array of items) so saved values are replaced by `@vk:` references.
 */
export function redactCliOutputToReferences(
  rawOutput: string,
  objectType?: string,
  itemId?: string,
): string {
  const trimmed = rawOutput.trim();
  if (!trimmed) {
    return rawOutput;
  }

  if (
    objectType &&
    ['password', 'totp', 'notes', 'username'].includes(objectType) &&
    itemId
  ) {
    return formatVkReference(itemId, objectType);
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      const redacted = parsed.map((entry) =>
        entry && typeof entry === 'object'
          ? projectItem(entry as Record<string, unknown>)
          : entry,
      );
      return JSON.stringify(redacted);
    }
    if (parsed && typeof parsed === 'object') {
      return JSON.stringify(projectItem(parsed as Record<string, unknown>));
    }
  } catch {
    // Non-JSON output
  }
  return rawOutput;
}

/**
 * Extracts all available `@vk:` reference descriptors from a parsed vault item list.
 */
export function extractReferenceDescriptors(
  items: Array<Record<string, unknown>>,
): VkReferenceDescriptor[] {
  const descriptors: VkReferenceDescriptor[] = [];

  for (const item of items) {
    const itemId = typeof item['id'] === 'string' ? item['id'] : '';
    const itemName = typeof item['name'] === 'string' ? item['name'] : itemId;
    if (!itemId) continue;

    if (item['type'] === TYPE_API_KEY && item['apiKey'] && typeof item['apiKey'] === 'object') {
      // The key's value may be hidden from this member's output; the reference still resolves.
      descriptors.push({
        reference: formatVkReference(itemId, 'key.value'),
        itemId,
        itemName,
        fieldPath: 'key.value',
        label: `${itemName} — Key`,
      });
    }

    if (item['login'] && typeof item['login'] === 'object') {
      const login = item['login'] as Record<string, unknown>;
      if (typeof login['username'] === 'string' && login['username']) {
        descriptors.push({
          reference: formatVkReference(itemId, 'login.username'),
          itemId,
          itemName,
          fieldPath: 'login.username',
          label: `${itemName} — Username`,
        });
      }
      if (typeof login['password'] === 'string' && login['password']) {
        descriptors.push({
          reference: formatVkReference(itemId, 'login.password'),
          itemId,
          itemName,
          fieldPath: 'login.password',
          label: `${itemName} — Password`,
        });
      }
      if (typeof login['totp'] === 'string' && login['totp']) {
        descriptors.push({
          reference: formatVkReference(itemId, 'login.totp'),
          itemId,
          itemName,
          fieldPath: 'login.totp',
          label: `${itemName} — Verification code`,
        });
      }
    }

    if (item['identity'] && typeof item['identity'] === 'object') {
      const identity = item['identity'] as Record<string, unknown>;
      for (const [key, val] of Object.entries(identity)) {
        if (typeof val === 'string' && val.length > 0) {
          descriptors.push({
            reference: formatVkReference(itemId, `identity.${key}`),
            itemId,
            itemName,
            fieldPath: `identity.${key}`,
            label: `${itemName} — ${key}`,
          });
        }
      }
    }

    if (Array.isArray(item['fields'])) {
      for (const field of item['fields'] as Array<Record<string, unknown>>) {
        const fname = typeof field['name'] === 'string' ? field['name'] : '';
        const fval = typeof field['value'] === 'string' ? field['value'] : '';
        if (fname && fval && fname !== VK_META_FIELD) {
          descriptors.push({
            reference: formatVkReference(itemId, `field.${fname}`),
            itemId,
            itemName,
            fieldPath: `field.${fname}`,
            label: `${itemName} — ${fname}`,
          });
        }
      }
    }
  }

  return descriptors;
}

/**
 * Validates an `access_request.v1alpha2` payload against the 1Password agentic autofill rules:
 * - 1..=5 credential requests with unique `entryId`s
 * - `goal` of 1..=140 characters
 * - `reason` of 1..=100 characters
 * - 1..=5 `keywords` per request, each 1..=50 characters
 * - optional `loginUrl` of at most 2083 characters
 */
export function validateAccessRequestV1Alpha2(
  req: AccessRequestV1Alpha2,
): { valid: true } | { valid: false; error: string } {
  if (req.version !== 'access_request.v1alpha2') {
    return {
      valid: false,
      error: 'unsupported access request version: expected access_request.v1alpha2',
    };
  }
  if (!req.goal || req.goal.trim().length === 0) {
    return { valid: false, error: 'goal is required' };
  }
  if (req.goal.length > 140) {
    return { valid: false, error: 'goal exceeds maximum length of 140 characters' };
  }
  if (!req.reason || req.reason.trim().length === 0) {
    return { valid: false, error: 'reason is required' };
  }
  if (req.reason.length > 100) {
    return {
      valid: false,
      error: 'reason exceeds maximum length of 100 characters',
    };
  }
  if (!Array.isArray(req.requests) || req.requests.length < 1 || req.requests.length > 5) {
    return {
      valid: false,
      error: 'requests must contain between 1 and 5 credential entries',
    };
  }

  const seenIds = new Set<string>();
  for (const entry of req.requests) {
    if (!entry.entryId || entry.entryId.trim().length === 0) {
      return { valid: false, error: 'entryId is required for each request' };
    }
    if (seenIds.has(entry.entryId)) {
      return {
        valid: false,
        error: `duplicate entryId in access request: ${entry.entryId}`,
      };
    }
    seenIds.add(entry.entryId);

    if (
      !Array.isArray(entry.keywords) ||
      entry.keywords.length < 1 ||
      entry.keywords.length > 5
    ) {
      return {
        valid: false,
        error: `entry ${entry.entryId} must provide between 1 and 5 keywords`,
      };
    }
    for (const kw of entry.keywords) {
      if (typeof kw !== 'string' || kw.length < 1 || kw.length > 50) {
        return {
          valid: false,
          error: `keyword in entry ${entry.entryId} must be between 1 and 50 characters`,
        };
      }
    }
    if (entry.loginUrl !== undefined && entry.loginUrl.length > 2083) {
      return {
        valid: false,
        error: `loginUrl in entry ${entry.entryId} exceeds maximum length of 2083 characters`,
      };
    }
  }

  return { valid: true };
}
