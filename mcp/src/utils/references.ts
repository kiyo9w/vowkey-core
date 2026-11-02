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
  keywords?: string[] | undefined;
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

/** Maximum fields per MCP access / form fill request (chunked in 5s over the broker wire). */
export const MAX_ACCESS_REQUEST_ENTRIES = 200;

/** The name of the Hidden field that carries a profile's detail envelope or a profile link. */
export const VK_META_FIELD = 'vk.meta';

/** Item objects whose every saved string becomes a reference: SSH key, bank account, licence, passport. */
const REDACTED_OBJECTS = [
  'sshKey',
  'bankAccount',
  'driversLicense',
  'passport',
] as const;

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
 * Strips userinfo credentials (`user:pass@`), query strings (`?token=...`), and fragments (`#...`)
 * from a URI so an AI agent sees only the clean origin/scheme and domain needed to match an item.
 */
export function sanitizeUriForAgent(rawUri: string): {
  uri: string;
  domain?: string;
} {
  const trimmed = rawUri.trim();
  if (!trimmed) {
    return { uri: '' };
  }
  const withoutUserInfo = trimmed.replace(
    /^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^/]*@/,
    '$1',
  );
  try {
    const parsed = new URL(withoutUserInfo);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return {
        uri: parsed.origin,
        ...(parsed.hostname ? { domain: parsed.hostname } : {}),
      };
    }
    const nonHttp = `${parsed.protocol}//${parsed.host || parsed.pathname.split('/')[0] || ''}`;
    return {
      uri: nonHttp,
      ...(parsed.hostname ? { domain: parsed.hostname } : {}),
    };
  } catch {
    // Handle bare hostnames or custom schemes without leaking userinfo/query/hash
    const noHashOrQuery = withoutUserInfo.split(/[?#]/)[0] ?? '';
    const hostMatch = /^(?:[a-zA-Z][a-zA-Z0-9+.-]*:\/\/)?([^/:]+)/.exec(
      noHashOrQuery,
    );
    const domain = hostMatch?.[1];
    if (domain && /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(domain)) {
      return {
        uri: noHashOrQuery.startsWith('http')
          ? `https://${domain}`
          : noHashOrQuery,
        domain,
      };
    }
    return { uri: '[redacted-uri]' };
  }
}

/**
 * Replaces raw secret and profile values in a single vault item object with `@vk:` references
 * so that MCP tool results carry references and outcomes rather than raw values.
 */
export function redactItemObjectToReferences(
  item: Record<string, unknown>,
): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...item };
  const id =
    typeof clone['id'] === 'string' && clone['id'] ? clone['id'] : 'item';

  if (typeof clone['notes'] === 'string' && clone['notes'].length > 0) {
    clone['notes'] = formatVkReference(id, 'notes');
  }

  if (Array.isArray(clone['passwordHistory'])) {
    clone['passwordHistory'] = (
      clone['passwordHistory'] as Array<Record<string, unknown>>
    ).map((entry, idx) => ({
      lastUsedDate: entry?.['lastUsedDate'] ?? null,
      password: formatVkReference(id, `passwordHistory.${idx}`),
    }));
  }

  if (Array.isArray(clone['attachments'])) {
    clone['attachments'] = (
      clone['attachments'] as Array<Record<string, unknown>>
    ).map((att, idx) => {
      const attId =
        typeof att?.['id'] === 'string' && att['id'] ? att['id'] : `${idx}`;
      return {
        id: attId,
        fileName: att?.['fileName'] ?? null,
        size: att?.['size'] ?? null,
        sizeName: att?.['sizeName'] ?? null,
        reference: formatVkReference(id, `attachment.${attId}`),
      };
    });
  }

  if (clone['login'] && typeof clone['login'] === 'object') {
    const login = { ...(clone['login'] as Record<string, unknown>) };
    if (typeof login['username'] === 'string' && login['username'].length > 0) {
      login['username'] = formatVkReference(id, 'login.username');
    }
    if (typeof login['password'] === 'string' && login['password'].length > 0) {
      login['password'] = formatVkReference(id, 'login.password');
    }
    if (typeof login['totp'] === 'string' && login['totp'].length > 0) {
      login['totp'] = formatVkReference(id, 'login.totp');
    }
    if (typeof login['uri'] === 'string' && login['uri'].length > 0) {
      login['uri'] = sanitizeUriForAgent(login['uri']).uri;
    }
    if (Array.isArray(login['uris'])) {
      login['uris'] = (login['uris'] as Array<Record<string, unknown>>).map(
        (u) => {
          const raw = typeof u?.['uri'] === 'string' ? u['uri'] : '';
          const sanitized = sanitizeUriForAgent(raw);
          return {
            uri: sanitized.uri,
            ...(sanitized.domain ? { domain: sanitized.domain } : {}),
            ...(u?.['match'] !== undefined ? { match: u['match'] } : {}),
          };
        },
      );
    }
    if (Array.isArray(login['fido2Credentials'])) {
      login['fido2Credentials'] = (
        login['fido2Credentials'] as Array<Record<string, unknown>>
      ).map((cred, idx) => ({
        credentialId: cred?.['credentialId'] ?? null,
        rpId: cred?.['rpId'] ?? null,
        rpName: cred?.['rpName'] ?? null,
        creationDate: cred?.['creationDate'] ?? null,
        reference: formatVkReference(id, `login.passkey.${idx}`),
      }));
    }
    clone['login'] = login;
  }

  if (clone['card'] && typeof clone['card'] === 'object') {
    const card = { ...(clone['card'] as Record<string, unknown>) };
    for (const key of [
      'number',
      'code',
      'cardholderName',
      'expMonth',
      'expYear',
    ]) {
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
      .map((f, idx) => {
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
      });
  }

  return clone;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** A key item for a tool: its name, hosts and send style, and a reference where the value is. */
function projectApiKey(
  item: Record<string, unknown>,
  id: string,
): Record<string, unknown> {
  const source = (item['apiKey'] ?? {}) as Record<string, unknown>;
  const rawBasicUser = source['basicUsername'];
  const out: Record<string, unknown> = {
    id,
    name: item['name'],
    type: TYPE_API_KEY,
    organizationId: item['organizationId'] ?? null,
    collectionIds: item['collectionIds'] ?? [],
    apiKey: {
      sendStyle: source['sendStyle'],
      allowedHosts: Array.isArray(source['allowedHosts'])
        ? source['allowedHosts']
        : [],
      headerName: source['headerName'],
      basicUsername:
        typeof rawBasicUser === 'string' && rawBasicUser.length > 0
          ? formatVkReference(id, 'key.basicUsername')
          : rawBasicUser,
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
        .filter(
          (m) =>
            typeof m['name'] === 'string' && typeof m['itemId'] === 'string',
        )
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
 * Projects a Vowkey Send object from an allowlist so text payloads, passwords, notes and keys
 * never reach the LLM context window while metadata, share URL and `@vk:` references stay intact.
 */
export function projectSendObject(
  send: Record<string, unknown>,
): Record<string, unknown> {
  const id = typeof send['id'] === 'string' && send['id'] ? send['id'] : 'send';
  const rawAccessUrl =
    typeof send['accessUrl'] === 'string'
      ? send['accessUrl'].replace(
          /https?:\/\/([a-z0-9.-]*\.)?vowkey\.com/gi,
          (match) => match.replace(/vowkey\.com/i, 'vowkey.app'),
        )
      : null;

  const out: Record<string, unknown> = {
    id,
    accessId: send['accessId'] ?? null,
    accessUrl: rawAccessUrl,
    name: send['name'] ?? null,
    type: send['type'] ?? null,
    disabled: Boolean(send['disabled']),
    passwordProtected: Boolean(send['password']),
    maxAccessCount: send['maxAccessCount'] ?? null,
    accessCount: send['accessCount'] ?? 0,
    revisionDate: send['revisionDate'] ?? null,
    expirationDate: send['expirationDate'] ?? null,
    deletionDate: send['deletionDate'] ?? null,
    reference: formatVkReference(id, 'send'),
  };

  if (stringOrUndefined(send['notes'])) {
    out['notes'] = formatVkReference(id, 'send.notes');
  }
  if (send['text'] && typeof send['text'] === 'object') {
    const textObj = send['text'] as Record<string, unknown>;
    out['text'] = {
      hidden: Boolean(textObj['hidden']),
      reference: formatVkReference(id, 'send.text'),
    };
  }
  if (send['file'] && typeof send['file'] === 'object') {
    const fileObj = send['file'] as Record<string, unknown>;
    out['file'] = {
      id: fileObj['id'] ?? null,
      fileName: fileObj['fileName'] ?? null,
      size: fileObj['size'] ?? null,
      sizeName: fileObj['sizeName'] ?? null,
      reference: formatVkReference(id, 'send.file'),
    };
  }
  return out;
}

/**
 * Redacts the CLI's output for a Send or a list of Sends. Non-JSON output is rejected.
 */
export function redactSendOutput(rawOutput: string): string {
  try {
    const parsed: unknown = JSON.parse(rawOutput);
    if (Array.isArray(parsed)) {
      return JSON.stringify(
        parsed.map((entry) =>
          entry && typeof entry === 'object'
            ? projectSendObject(entry as Record<string, unknown>)
            : { code: 'unexpected-output' },
        ),
      );
    }
    if (parsed && typeof parsed === 'object') {
      return JSON.stringify(
        projectSendObject(parsed as Record<string, unknown>),
      );
    }
  } catch {
    // Non-JSON output
  }
  return JSON.stringify({ code: 'unexpected-output' });
}

/**
 * What a tool result carries for one item. Vowkey's own item types are built from an allowlist,
 * so a field the CLI adds later is left out instead of copied through; the others have each saved
 * string replaced by a reference.
 */
export function projectItem(
  item: Record<string, unknown>,
): Record<string, unknown> {
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

function projectNonItemEntry(
  entry: Record<string, unknown>,
  listOrObjectType?: string,
): Record<string, unknown> {
  if (listOrObjectType === 'org-members') {
    const memberId =
      typeof entry['id'] === 'string' && entry['id'] ? entry['id'] : 'member';
    return {
      id: memberId,
      name: entry['name'] ?? null,
      type: entry['type'] ?? null,
      status: entry['status'] ?? null,
      email:
        typeof entry['email'] === 'string' && entry['email'].length > 0
          ? formatVkReference(memberId, 'member.email')
          : null,
    };
  }
  return projectItem(entry);
}

/**
 * Redacts CLI output so saved values, URI query tokens, and unparsed raw text never leak.
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

  const safeId = itemId && itemId.trim() ? itemId.trim() : 'item';

  if (
    objectType &&
    ['password', 'totp', 'notes', 'username'].includes(objectType)
  ) {
    const fieldPath = objectType === 'notes' ? 'notes' : `login.${objectType}`;
    return JSON.stringify({
      itemId: safeId,
      object: objectType,
      reference: formatVkReference(safeId, fieldPath),
    });
  }

  if (objectType === 'uri') {
    const clean = sanitizeUriForAgent(trimmed);
    return JSON.stringify({
      itemId: safeId,
      object: 'uri',
      uri: clean.uri,
      ...(clean.domain ? { domain: clean.domain } : {}),
      reference: formatVkReference(safeId, 'login.uri'),
    });
  }

  if (objectType === 'exposed') {
    const count = /^\d+$/.test(trimmed) ? Number(trimmed) : null;
    return JSON.stringify({
      itemId: safeId,
      object: 'exposed',
      exposedCount: count,
      reference: formatVkReference(safeId, 'login.password'),
    });
  }

  if (objectType === 'attachment') {
    return JSON.stringify({
      itemId: safeId,
      object: 'attachment',
      saved: true,
      reference: formatVkReference(safeId, 'attachment'),
    });
  }

  if (
    objectType === 'fingerprint' &&
    /^[a-z0-9-]+$/i.test(trimmed) &&
    trimmed.length <= 128
  ) {
    return JSON.stringify({
      object: 'fingerprint',
      subject: safeId,
      fingerprint: trimmed,
    });
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      const redacted = parsed.map((entry) =>
        entry && typeof entry === 'object'
          ? projectNonItemEntry(entry as Record<string, unknown>, objectType)
          : { code: 'unexpected-output' },
      );
      return JSON.stringify(redacted);
    }
    if (parsed && typeof parsed === 'object') {
      return JSON.stringify(
        projectNonItemEntry(parsed as Record<string, unknown>, objectType),
      );
    }
  } catch {
    // Non-JSON output is never echoed back to the caller.
  }
  return JSON.stringify({ code: 'unexpected-output' });
}

/**
 * Scrubs CLI error output so unexpected stderr strings never echo secret tokens, URLs with query
 * credentials, or multi-line stack traces into the LLM context window.
 */
export function scrubErrorOutput(rawError: string): string {
  const firstLine = (rawError.split(/\r?\n/)[0] ?? '').trim();
  if (!firstLine) {
    return 'Operation failed.';
  }
  return firstLine
    .replace(/https?:\/\/[^\s)'"`]+/gi, (url) => sanitizeUriForAgent(url).uri)
    .replace(
      /\b(sk-[a-zA-Z0-9_-]{8,}|ghp_[a-zA-Z0-9]{8,}|Bearer\s+[^\s]+)/g,
      '[redacted]',
    )
    .replace(/[A-Za-z0-9+/=]{48,}/g, '[redacted]')
    .slice(0, 240);
}

/**
 * Resolves a single `@vk:` field path against a raw item inside the MCP process when writing
 * directly to a local `.env` file on disk. Never expose the return value in an MCP tool result.
 */
export function resolveVkFieldOnRawItem(
  rawItem: Record<string, unknown>,
  fieldPath: string,
): string | null {
  if (fieldPath === 'key.value') {
    const apiKey = rawItem['apiKey'] as Record<string, unknown> | undefined;
    if (typeof apiKey?.['value'] === 'string') return apiKey['value'];
  }
  if (fieldPath === 'notes' && typeof rawItem['notes'] === 'string') {
    return rawItem['notes'];
  }
  if (fieldPath.startsWith('login.')) {
    const key = fieldPath.slice('login.'.length);
    const login = rawItem['login'] as Record<string, unknown> | undefined;
    if (typeof login?.[key] === 'string') return login[key] as string;
  }
  if (fieldPath.startsWith('identity.')) {
    const key = fieldPath.slice('identity.'.length);
    const identity = rawItem['identity'] as Record<string, unknown> | undefined;
    if (typeof identity?.[key] === 'string') return identity[key] as string;
  }
  if (fieldPath.startsWith('card.')) {
    const key = fieldPath.slice('card.'.length);
    const card = rawItem['card'] as Record<string, unknown> | undefined;
    if (typeof card?.[key] === 'string') return card[key] as string;
  }
  if (fieldPath.startsWith('field.') && Array.isArray(rawItem['fields'])) {
    const targetName = fieldPath.slice('field.'.length);
    const hit = (rawItem['fields'] as Array<Record<string, unknown>>).find(
      (f) => f['name'] === targetName,
    );
    if (typeof hit?.['value'] === 'string') return hit['value'];
  }
  return null;
}

/** The profile envelope in an item's `vk.meta` field, when it has one this version understands. */
function readProfileEnvelope(item: Record<string, unknown>): {
  status: unknown;
  details: Array<Record<string, unknown>>;
} | null {
  if (!Array.isArray(item['fields'])) {
    return null;
  }
  const carrier = (item['fields'] as Array<Record<string, unknown>>).find(
    (f) => f['name'] === VK_META_FIELD,
  );
  if (typeof carrier?.['value'] !== 'string') {
    return null;
  }
  try {
    const parsed = JSON.parse(carrier['value']) as Record<string, unknown>;
    if (parsed['v'] !== 1 || !Array.isArray(parsed['details'])) {
      return null;
    }
    return {
      status: parsed['status'],
      details: parsed['details'] as Array<Record<string, unknown>>,
    };
  } catch {
    return null;
  }
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

    if (
      item['type'] === TYPE_API_KEY &&
      item['apiKey'] &&
      typeof item['apiKey'] === 'object'
    ) {
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

    const envelope = readProfileEnvelope(item);
    if (envelope != null) {
      // A profile with details of its own is described by their ids, not by field names.
      if (envelope.status === 'confirmed') {
        for (const detail of envelope.details) {
          const detailId = typeof detail['id'] === 'string' ? detail['id'] : '';
          const label =
            typeof detail['label'] === 'string' ? detail['label'] : detailId;
          if (detailId) {
            descriptors.push({
              reference: formatVkReference(itemId, `detail.${detailId}`),
              itemId,
              itemName,
              fieldPath: `detail.${detailId}`,
              label: `${itemName} — ${label}`,
            });
          }
        }
      }
    } else if (Array.isArray(item['fields'])) {
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
 * The references a request already names. A missing or gallery-style name is refused.
 * Nothing here invents `@vk:<entryId>/default`.
 */
export function accessRequestAssignments(
  req: AccessRequestV1Alpha2,
):
  | { ok: true; assignments: { fieldId: string; reference: string }[] }
  | { ok: false; code: 'invalid_reference' } {
  const assignments: { fieldId: string; reference: string }[] = [];
  for (const entry of req.requests) {
    if (entry.reference == null || parseVkReference(entry.reference) == null) {
      return { ok: false, code: 'invalid_reference' };
    }
    assignments.push({
      fieldId: entry.entryId,
      reference: entry.reference.trim(),
    });
  }
  return { ok: true, assignments };
}

/**
 * Validates an `access_request.v1alpha2` payload:
 * - 1..=200 field requests with unique `entryId`s (supports full multi-section forms in one batch)
 * - `goal` of 1..=140 characters
 * - `reason` of 1..=100 characters
 * - optional `keywords` per request (1..=10 keywords, each 1..=50 characters when supplied)
 * - optional `loginUrl` of at most 2083 characters
 */
export function validateAccessRequestV1Alpha2(
  req: AccessRequestV1Alpha2,
): { valid: true } | { valid: false; error: string } {
  if (req.version !== 'access_request.v1alpha2') {
    return {
      valid: false,
      error:
        'unsupported access request version: expected access_request.v1alpha2',
    };
  }
  if (!req.goal || req.goal.trim().length === 0) {
    return { valid: false, error: 'goal is required' };
  }
  if (req.goal.length > 140) {
    return {
      valid: false,
      error: 'goal exceeds maximum length of 140 characters',
    };
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
  if (
    !Array.isArray(req.requests) ||
    req.requests.length < 1 ||
    req.requests.length > MAX_ACCESS_REQUEST_ENTRIES
  ) {
    return {
      valid: false,
      error: `requests must contain between 1 and ${MAX_ACCESS_REQUEST_ENTRIES} field entries`,
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

    if (entry.keywords !== undefined) {
      if (
        !Array.isArray(entry.keywords) ||
        entry.keywords.length < 1 ||
        entry.keywords.length > 10
      ) {
        return {
          valid: false,
          error: `entry ${entry.entryId} keywords must contain between 1 and 10 items`,
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
