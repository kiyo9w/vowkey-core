import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  handleGet,
  handleProxyStatus,
  handleSyncEnvFile,
} from '../src/handlers/cli.js';
import { _resetBwInvocationCacheForTests } from '../src/utils/vowkey-cli.js';

// A stand-in for the command line, run through the same child-process path the tools use. It
// answers from the first arguments it is given and records nothing else.
const FAKE = `
const args = process.argv.slice(2);
const key = args.slice(0, 2).join(' ');
const out = (v) => process.stdout.write(typeof v === 'string' ? v : JSON.stringify(v));
if (key === 'env file' && args.includes('broken')) { process.stderr.write('internal failure at /usr/lib/x.js with sk-live-0123456789'); process.exit(1); }
if (key === 'env file' && args.includes('--enable')) {
  if (args.some((a) => a.includes('deny'))) { process.stderr.write('refused: the file already exists and is not a file Vowkey wrote'); process.exit(1); }
  out({ environmentId: 'env-1', enabled: true, path: args[args.indexOf('--path') + 1], state: 'written', managedToken: 'must-not-appear' });
} else if (key === 'env file') {
  out({ environmentId: 'env-1', enabled: false, path: '/p/.env', state: 'removed' });
} else if (key === 'proxy status') {
  out({ listening: true, host: '127.0.0.1', port: 47623, credential: 'must-not-appear' });
} else if (key === 'get item' && args[2] === 'key-1') {
  out({ id: 'key-1', name: 'OpenAI', type: 100, apiKey: { value: 'sk-live-0123456789', sendStyle: 'bearer', allowedHosts: ['api.openai.com'] } });
} else if (key === 'get item' && args[2] === 'plain') {
  out('hunter2-raw-text');
} else if (key === 'env file') {
  process.exit(1);
} else {
  process.stderr.write('something internal: stack trace with sk-live-0123456789');
  process.exit(1);
}
`;

describe('developer secrets tools', () => {
  let dir: string;
  let work: string;
  let deny: string;
  const saved = process.env['VOWKEY_CLI_PATH'];
  const savedDirs = process.env['VOWKEY_ALLOWED_DIRECTORIES'];

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vowkey-mcp-'));
    const entry = path.join(dir, 'fake-vowkey.js');
    fs.writeFileSync(entry, FAKE);
    process.env['VOWKEY_CLI_PATH'] = entry;
    process.env['VOWKEY_ALLOWED_DIRECTORIES'] = dir;
    work = path.join(dir, 'work', '.env');
    deny = path.join(dir, 'deny', '.env');
    _resetBwInvocationCacheForTests();
  });
  afterAll(() => {
    if (saved === undefined) delete process.env['VOWKEY_CLI_PATH'];
    else process.env['VOWKEY_CLI_PATH'] = saved;
    if (savedDirs === undefined) delete process.env['VOWKEY_ALLOWED_DIRECTORIES'];
    else process.env['VOWKEY_ALLOWED_DIRECTORIES'] = savedDirs;
    _resetBwInvocationCacheForTests();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const text = (r: { content: Array<{ text?: string }> }) => r.content[0]?.text ?? '';

  it('sync_env_file asks the command line to write the file and reports only the state', async () => {
    const result = await handleSyncEnvFile({
      environmentId: 'env-1',
      path: work,
      enabled: true,
    });
    expect(result.isError).toBe(false);
    expect(JSON.parse(text(result))).toEqual({
      environmentId: 'env-1',
      enabled: true,
      path: work,
      state: 'written',
    });
  });

  it('sync_env_file disables through the same command', async () => {
    const result = await handleSyncEnvFile({
      environmentId: 'env-1',
      path: work,
      enabled: false,
    });
    expect(JSON.parse(text(result))).toMatchObject({ enabled: false, state: 'removed' });
  });

  it('sync_env_file no longer takes a variable map', async () => {
    const result = await handleSyncEnvFile({
      envFilePath: '/work/.env',
      variables: { A: '@vk:x/key.value' },
    } as never);
    expect(result.isError).toBe(true);
  });

  it('turns a command-line refusal into a code and message', async () => {
    const result = await handleSyncEnvFile({
      environmentId: 'env-1',
      path: deny,
      enabled: true,
    });
    expect(result.isError).toBe(true);
    expect(JSON.parse(text(result))).toEqual({
      code: 'refused',
      message: 'the file already exists and is not a file Vowkey wrote',
    });
  });

  it('answers an error it does not recognise with a generic code, never the command line\'s text', async () => {
    const result = await handleSyncEnvFile({ environmentId: 'broken', path: work, enabled: true });
    expect(result.isError).toBe(true);
    expect(JSON.parse(text(result))).toEqual({ code: 'unavailable', message: 'The request failed.' });
    expect(text(result)).not.toContain('sk-live');
  });

  it('proxy_status carries listening, host and port, and nothing else', async () => {
    const result = await handleProxyStatus({});
    expect(result.isError).toBe(false);
    expect(JSON.parse(text(result))).toEqual({
      listening: true,
      host: '127.0.0.1',
      port: 47623,
    });
  });

  it('get item of a key returns a reference where the value is', async () => {
    const result = await handleGet({ object: 'item', id: 'key-1' });
    const body = text(result);
    expect(body).not.toContain('sk-live');
    expect(JSON.parse(body).apiKey.value).toBe('@vk:key-1/key.value');
  });

  it('get item with a body that is not an item returns a code and no raw text', async () => {
    const result = await handleGet({ object: 'item', id: 'plain' });
    expect(text(result)).toBe('{"code":"unexpected-output"}');
  });
});
