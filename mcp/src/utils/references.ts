/**
 * Value-blind `@vk:` references, `access_request.v1alpha2` validation,
 * synced `.env` files, `vowkey run` injection, and host-matched key proxy
 * (copying 1Password Agentic Autofill, 1Password Environments, and Infisical Agent Vault).
 */

import * as fs from 'fs';

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

export interface HostBoundCredential {
  placeholder: string;
  realValue: string;
  allowedHosts: string[];
}

const VK_REF_REGEX = /^@vk:([^/\s]+)\/(.+)$/;

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

  if (Array.isArray(clone['fields'])) {
    clone['fields'] = (clone['fields'] as Array<Record<string, unknown>>).map(
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
          ? redactItemObjectToReferences(entry as Record<string, unknown>)
          : entry,
      );
      return JSON.stringify(redacted);
    }
    if (parsed && typeof parsed === 'object') {
      return JSON.stringify(
        redactItemObjectToReferences(parsed as Record<string, unknown>),
      );
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
        if (fname && fval) {
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

/**
 * Syncs a local `.env` file with a map of environment variable names to `@vk:` references
 * (copying 1Password Environments). Returns the variable names synced without exposing values.
 */
export function syncEnvFileWithReferences(
  envFilePath: string,
  variables: Record<string, string>,
): { syncedKeys: string[]; path: string } {
  const keys = Object.keys(variables).sort();
  const lines = keys.map((k) => `${k}=${variables[k]}`);
  fs.writeFileSync(envFilePath, lines.join('\n') + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  });
  return {
    syncedKeys: keys,
    path: envFilePath,
  };
}

/**
 * Checks whether a target request URL's host matches a credential's allowed host list
 * (copying Infisical Agent Vault `internal/brokercore/credential.go`).
 */
export function hostMatchesAllowedList(
  targetUrl: string,
  allowedHosts: string[],
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !isLocal) {
    return false;
  }

  for (const rawPattern of allowedHosts) {
    const pattern = rawPattern.trim().toLowerCase();
    if (!pattern) continue;
    if (pattern === hostname) {
      return true;
    }
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1); // ".example.com"
      if (hostname.endsWith(suffix) && hostname.length > suffix.length) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Substitutes registered placeholder tokens with their real key values ONLY when `targetUrl`
 * matches the credential's `allowedHosts`. Requests to other hosts pass through unchanged.
 */
export function substituteHostBoundCredentials(
  targetUrl: string,
  headers: Record<string, string>,
  credentials: HostBoundCredential[],
): { headers: Record<string, string>; substitutedPlaceholders: string[] } {
  const updated: Record<string, string> = { ...headers };
  const substituted: string[] = [];

  for (const cred of credentials) {
    if (!cred.placeholder || !hostMatchesAllowedList(targetUrl, cred.allowedHosts)) {
      continue;
    }
    for (const [hKey, hVal] of Object.entries(updated)) {
      if (hVal.includes(cred.placeholder)) {
        updated[hKey] = hVal.split(cred.placeholder).join(cred.realValue);
        if (!substituted.includes(cred.placeholder)) {
          substituted.push(cred.placeholder);
        }
      }
    }
  }

  return { headers: updated, substitutedPlaceholders: substituted };
}
