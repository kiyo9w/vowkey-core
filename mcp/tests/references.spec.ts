import { describe, it, expect } from '@jest/globals';
import {
  extractReferenceDescriptors,
  formatVkReference,
  parseVkReference,
  projectItem,
  redactCliOutputToReferences,
  redactItemOutput,
  validateAccessRequestV1Alpha2,
} from '../src/utils/references.js';

describe('Vowkey value-blind @vk: references and access requests', () => {
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
      reason:
        'User asked to complete account opening with residence card details',
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

  it('builds a key from an allowlist: its hosts and send style stay, its value becomes a reference', () => {
    const projected = projectItem({
      id: 'key-1',
      name: 'OpenAI',
      type: 100,
      organizationId: null,
      collectionIds: [],
      notes: 'rotate in march',
      apiKey: {
        value: 'sk-live-0123456789',
        sendStyle: 'bearer',
        allowedHosts: ['api.openai.com'],
        headerName: null,
        basicUsername: null,
        somethingNew: 'must-not-pass-through',
      },
      fields: [{ name: 'vk.meta', value: '{"v":1}', type: 1 }],
      unexpected: 'also left out',
    });
    const text = JSON.stringify(projected);
    expect(projected['apiKey']).toEqual({
      sendStyle: 'bearer',
      allowedHosts: ['api.openai.com'],
      headerName: null,
      basicUsername: null,
      value: '@vk:key-1/key.value',
    });
    expect(projected['notes']).toBe('@vk:key-1/notes');
    expect(text).not.toContain('sk-live');
    expect(text).not.toContain('must-not-pass-through');
    expect(text).not.toContain('also left out');
    expect(text).not.toContain('vk.meta');
  });

  it('lists an environment as names, item ids and references', () => {
    const projected = projectItem({
      id: 'env-1',
      name: 'production',
      type: 101,
      environment: { members: [{ name: 'OPENAI_API_KEY', itemId: 'key-1' }] },
    });
    expect(projected['environment']).toEqual({
      members: [
        {
          name: 'OPENAI_API_KEY',
          itemId: 'key-1',
          reference: '@vk:key-1/key.value',
        },
      ],
    });
  });

  it('replaces every saved string of an SSH key, bank account, licence and passport', () => {
    const redacted = redactItemOutput(
      JSON.stringify([
        {
          id: 's1',
          name: 'Deploy key',
          type: 5,
          sshKey: {
            privateKey: 'PRIVATE-KEY-BYTES',
            publicKey: 'ssh-ed25519 AAAA',
            keyFingerprint: 'SHA256:abc',
          },
        },
        {
          id: 'b1',
          name: 'Bank',
          type: 6,
          bankAccount: { accountNumber: '000123456789', pin: '4321' },
        },
        {
          id: 'd1',
          name: 'Licence',
          type: 7,
          driversLicense: { licenseNumber: 'LIC-998877' },
        },
        {
          id: 'p1',
          name: 'Passport',
          type: 8,
          passport: { passportNumber: 'C8492011' },
        },
      ]),
    );
    for (const secret of [
      'PRIVATE-KEY-BYTES',
      '000123456789',
      '4321',
      'LIC-998877',
      'C8492011',
    ]) {
      expect(redacted).not.toContain(secret);
    }
    expect(redacted).toContain('@vk:s1/sshKey.privateKey');
    expect(redacted).toContain('@vk:b1/bankAccount.accountNumber');
    expect(redacted).toContain('@vk:d1/driversLicense.licenseNumber');
    expect(redacted).toContain('@vk:p1/passport.passportNumber');
  });

  it('never passes a body that is not JSON through as an item', () => {
    expect(redactItemOutput('hunter2-raw-text')).toBe(
      '{"code":"unexpected-output"}',
    );
    expect(redactItemOutput('"just a string"')).toBe(
      '{"code":"unexpected-output"}',
    );
  });

  it('leaves the profile envelope field out of redacted items and descriptors', () => {
    const item = {
      id: 'prof-1',
      name: 'Linh',
      fields: [
        { name: 'vk.meta', value: '{"v":1,"details":[]}', type: 1 },
        { name: 'Note', value: 'hello', type: 0 },
      ],
    };
    expect(JSON.stringify(projectItem(item))).not.toContain('vk.meta');
    expect(JSON.stringify(extractReferenceDescriptors([item]))).not.toContain(
      'vk.meta',
    );
  });

  it('describes a key by its value reference whether or not the value is visible', () => {
    const descriptors = extractReferenceDescriptors([
      {
        id: 'key-1',
        name: 'OpenAI',
        type: 100,
        apiKey: { sendStyle: 'bearer' },
      },
      {
        id: 'env-1',
        name: 'production',
        type: 101,
        environment: { members: [] },
      },
    ]);
    expect(descriptors.map((d) => d.reference)).toEqual([
      '@vk:key-1/key.value',
    ]);
  });

  it('does not parse the gallery spellings as references', () => {
    expect(parseVkReference('@vk:key.openai')).toBeNull();
    expect(parseVkReference('@vk:passport.no')).toBeNull();
  });

  it('describes a profile by its detail ids once it has an envelope, and not by field names', () => {
    const envelope = JSON.stringify({
      v: 1,
      profileId: 'prof-1',
      status: 'confirmed',
      kind: 'person',
      details: [
        {
          id: 'd1',
          attribute: 'id.passport.number',
          label: 'Passport number',
          variants: [],
        },
        { id: 'd2', attribute: null, label: 'Crew badge', variants: [] },
      ],
      sources: [],
    });
    const descriptors = extractReferenceDescriptors([
      {
        id: 'prof-1',
        name: 'Linh',
        identity: { passportNumber: 'C8492011' },
        fields: [
          { name: 'vk.meta', value: envelope, type: 1 },
          { name: 'id.passport.number', value: 'C8492011', type: 0 },
        ],
      },
    ]);
    const paths = descriptors.map((d) => d.fieldPath);
    expect(paths).toContain('detail.d1');
    expect(paths).toContain('detail.d2');
    expect(paths).toContain('identity.passportNumber');
    expect(paths).not.toContain('field.id.passport.number');
    expect(JSON.stringify(descriptors)).not.toContain('vk.meta');
  });

  it('lists no details for a draft profile', () => {
    const envelope = JSON.stringify({
      v: 1,
      status: 'draft',
      details: [{ id: 'd1', label: 'x' }],
      sources: [],
    });
    const descriptors = extractReferenceDescriptors([
      {
        id: 'p',
        name: 'Draft',
        fields: [{ name: 'vk.meta', value: envelope, type: 1 }],
      },
    ]);
    expect(descriptors).toEqual([]);
  });
});
