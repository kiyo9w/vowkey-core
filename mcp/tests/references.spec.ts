import { describe, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  extractReferenceDescriptors,
  formatVkReference,
  hostMatchesAllowedList,
  parseVkReference,
  redactCliOutputToReferences,
  substituteHostBoundCredentials,
  syncEnvFileWithReferences,
  validateAccessRequestV1Alpha2,
} from '../src/utils/references.js';

describe('Vowkey Value-Blind @vk: References, Access Requests & Host Key Proxy', () => {
  it('formats and parses @vk: references cleanly', () => {
    const ref = formatVkReference('item-123', 'identity.passportNumber');
    expect(ref).toBe('@vk:item-123/identity.passportNumber');
    expect(parseVkReference(ref)).toEqual({
      itemId: 'item-123',
      fieldPath: 'identity.passportNumber',
    });
  });

  it('redacts raw passwords, card numbers, identity details and custom fields from CLI output', () => {
    const rawItems = JSON.stringify([
      {
        id: '11111111-2222-3333-4444-555555555555',
        name: 'Mizuho Login',
        notes: 'super-secret-note',
        login: {
          username: 'linh',
          password: 'MyRawSecretPassword!123',
          totp: 'JBSWY3DPEHPK3PXP',
        },
        card: {
          number: '4111222233334444',
          code: '999',
        },
        identity: {
          firstName: 'Linh',
          passportNumber: 'C8492011',
        },
        fields: [
          { name: 'id.residence_card.number', value: 'AB12345678CD', type: 0 },
        ],
      },
    ]);

    const redacted = redactCliOutputToReferences(rawItems);
    expect(redacted).not.toContain('MyRawSecretPassword!123');
    expect(redacted).not.toContain('JBSWY3DPEHPK3PXP');
    expect(redacted).not.toContain('4111222233334444');
    expect(redacted).not.toContain('C8492011');
    expect(redacted).not.toContain('AB12345678CD');
    expect(redacted).toContain(
      '@vk:11111111-2222-3333-4444-555555555555/login.password',
    );
    expect(redacted).toContain(
      '@vk:11111111-2222-3333-4444-555555555555/identity.passportNumber',
    );
    expect(redacted).toContain(
      '@vk:11111111-2222-3333-4444-555555555555/field.id.residence_card.number',
    );
  });

  it('extracts @vk: reference descriptors without exposing values', () => {
    const descriptors = extractReferenceDescriptors([
      {
        id: 'prof-1',
        name: 'Linh Profile',
        identity: { passportNumber: 'C8492011' },
        fields: [{ name: 'bank.account.holder.zengin', value: 'ｸﾞｴﾝ ﾃｲ ﾘﾝ' }],
      },
    ]);
    expect(descriptors).toEqual([
      {
        reference: '@vk:prof-1/identity.passportNumber',
        itemId: 'prof-1',
        itemName: 'Linh Profile',
        fieldPath: 'identity.passportNumber',
        label: 'Linh Profile — passportNumber',
      },
      {
        reference: '@vk:prof-1/field.bank.account.holder.zengin',
        itemId: 'prof-1',
        itemName: 'Linh Profile',
        fieldPath: 'field.bank.account.holder.zengin',
        label: 'Linh Profile — bank.account.holder.zengin',
      },
    ]);
  });

  it('validates access_request.v1alpha2 bounds (1-5 unique entries, goal <= 140, reason <= 100)', () => {
    const valid = validateAccessRequestV1Alpha2({
      version: 'access_request.v1alpha2',
      agentId: 'com.vowkey.app-pairing.v1:codex',
      goal: 'Fill Mizuho Bank account opening form',
      reason: 'User asked to complete account opening with residence card details',
      requests: [
        {
          entryId: 'entry-1',
          keywords: ['mizuho', 'profile'],
          loginUrl: 'https://www.mizuhobank.co.jp/apply',
        },
      ],
    });
    expect(valid).toEqual({ valid: true });

    const duplicate = validateAccessRequestV1Alpha2({
      version: 'access_request.v1alpha2',
      agentId: 'codex',
      goal: 'Fill form',
      reason: 'Need login',
      requests: [
        { entryId: 'dup', keywords: ['a'] },
        { entryId: 'dup', keywords: ['b'] },
      ],
    });
    expect(duplicate.valid).toBe(false);

    const longGoal = validateAccessRequestV1Alpha2({
      version: 'access_request.v1alpha2',
      agentId: 'codex',
      goal: 'x'.repeat(141),
      reason: 'Need login',
      requests: [{ entryId: 'e1', keywords: ['a'] }],
    });
    expect(longGoal.valid).toBe(false);
  });

  it('syncs a .env file with @vk: references and substitutes keys only on allowed hosts', () => {
    const tmpFile = path.join(os.tmpdir(), `vowkey-test-${process.pid}.env`);
    const syncRes = syncEnvFileWithReferences(tmpFile, {
      OPENAI_API_KEY: '@vk:key-1/login.password',
      ANTHROPIC_API_KEY: '@vk:key-2/login.password',
    });
    expect(syncRes.syncedKeys).toEqual(['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']);
    const content = fs.readFileSync(tmpFile, 'utf8');
    expect(content).toContain('OPENAI_API_KEY=@vk:key-1/login.password');
    fs.unlinkSync(tmpFile);

    // Host-matched key proxy (Infisical Agent Vault behavior)
    expect(
      hostMatchesAllowedList('https://api.openai.com/v1/responses', [
        'api.openai.com',
      ]),
    ).toBe(true);
    expect(
      hostMatchesAllowedList('http://api.openai.com/v1/responses', [
        'api.openai.com',
      ]),
    ).toBe(false); // non-HTTPS rejected for remote host
    expect(
      hostMatchesAllowedList('https://evil.example.com/v1/responses', [
        'api.openai.com',
      ]),
    ).toBe(false);

    const allowedOut = substituteHostBoundCredentials(
      'https://api.openai.com/v1/responses',
      { Authorization: 'Bearer vk_placeholder_openai' },
      [
        {
          placeholder: 'vk_placeholder_openai',
          realValue: 'sk-live-real-secret-value',
          allowedHosts: ['api.openai.com'],
        },
      ],
    );
    expect(allowedOut.headers['Authorization']).toBe(
      'Bearer sk-live-real-secret-value',
    );
    expect(allowedOut.substitutedPlaceholders).toEqual([
      'vk_placeholder_openai',
    ]);

    const untrustedOut = substituteHostBoundCredentials(
      'https://attacker.example.com/steal',
      { Authorization: 'Bearer vk_placeholder_openai' },
      [
        {
          placeholder: 'vk_placeholder_openai',
          realValue: 'sk-live-real-secret-value',
          allowedHosts: ['api.openai.com'],
        },
      ],
    );
    expect(untrustedOut.headers['Authorization']).toBe(
      'Bearer vk_placeholder_openai',
    );
    expect(untrustedOut.substitutedPlaceholders).toEqual([]);
  });
});
