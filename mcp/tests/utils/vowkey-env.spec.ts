import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { buildBwChildEnv } from '../../src/utils/vowkey-env.js';

const originalEnv = { ...process.env };

describe('buildBwChildEnv', () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('passes through SystemRoot so the vowkey Node child can start on Windows', () => {
    process.env['SystemRoot'] = 'C:\\Windows';
    const env = buildBwChildEnv();
    expect(env['SystemRoot']).toBe('C:\\Windows');
  });

  it('passes through the SYSTEMROOT casing as well', () => {
    delete process.env['SystemRoot'];
    process.env['SYSTEMROOT'] = 'C:\\Windows';
    const env = buildBwChildEnv();
    expect(env['SYSTEMROOT']).toBe('C:\\Windows');
  });

  it('does not forward API client credentials to the child', () => {
    process.env['VOWKEY_CLIENT_ID'] = 'organization.secret-id';
    process.env['VOWKEY_CLIENT_SECRET'] = 'super-secret';
    const env = buildBwChildEnv();
    expect(env['VOWKEY_CLIENT_ID']).toBeUndefined();
    expect(env['VOWKEY_CLIENT_SECRET']).toBeUndefined();
  });

  it('merges extra entries (e.g. a one-shot password env var)', () => {
    const env = buildBwChildEnv({ VOWKEY_MCP_PW_ABC: 'pw' });
    expect(env['VOWKEY_MCP_PW_ABC']).toBe('pw');
  });
});
