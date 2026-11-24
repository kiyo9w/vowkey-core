import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  handleCreateTextSend,
  handleGenerate,
  handleGet,
  handleGetSend,
  handleList,
  handleListSend,
  handleSyncEnvFile,
} from '../src/handlers/cli.js';
import { _resetBwInvocationCacheForTests } from '../src/utils/vowkey-cli.js';

const SECRET_PASSWORD = 'RawVaultPassword#998877';
const SECRET_PASSPORT = 'JP99881122';
const SECRET_API_KEY = 'sk-live-supersecret9876543210';
const SECRET_SEND_TEXT = 'WireTransferCode-774411';
const SECRET_SEND_PASSWORD = 'SendPasscode-4422';
const SECRET_QUERY_TOKEN = 'oauth_code_secret_xyz987';
const SECRET_USERNAME = 'linh.private@example.jp';
const SECRET_GENERATED = 'GenSecret!Pass918273645';

const FAKE_CLI = `
const fs = require('fs');
const args = process.argv.slice(2);
const cmd = args[0];
const sub = args[1];
const out = (v) => process.stdout.write(typeof v === 'string' ? v : JSON.stringify(v));

if (cmd === 'list' && sub === 'items') {
  out([
    {
      id: 'item-gh',
      name: 'GitHub',
      type: 1,
      notes: 'Recovery codes: 1111-2222',
      passwordHistory: [{ lastUsedDate: '2026-01-01', password: 'OldPassword!111' }],
      attachments: [
        {
          id: 'att-1',
          fileName: 'recovery.txt',
          size: 120,
          sizeName: '120 B',
          url: 'https://vault.vowkey.app/download?sig=${SECRET_QUERY_TOKEN}',
          key: 'raw-attachment-encryption-key-secret'
        }
      ],
      login: {
        username: '${SECRET_USERNAME}',
        password: '${SECRET_PASSWORD}',
        totp: 'JBSWY3DPEHPK3PXP',
        uri: 'https://admin:${SECRET_PASSWORD}@github.com/login/oauth?code=${SECRET_QUERY_TOKEN}#frag',
        uris: [
          {
            uri: 'https://admin:${SECRET_PASSWORD}@github.com/login/oauth?code=${SECRET_QUERY_TOKEN}#frag',
            match: 0
          }
        ]
      }
    },
    {
      id: 'item-prof',
      name: 'Applicant Profile',
      type: 4,
      identity: {
        firstName: 'Linh',
        passportNumber: '${SECRET_PASSPORT}',
        email: '${SECRET_USERNAME}'
      }
    }
  ]);
} else if (cmd === 'list' && sub === 'org-members') {
  out([{ id: 'mem-1', name: 'Member', email: '${SECRET_USERNAME}', type: 2, status: 2 }]);
} else if (cmd === 'get' && sub === 'uri') {
  out('https://user:${SECRET_PASSWORD}@dashboard.stripe.com/callback?token=${SECRET_QUERY_TOKEN}#hash');
} else if (cmd === 'get' && sub === 'password') {
  out('${SECRET_PASSWORD}');
} else if (cmd === 'get' && sub === 'username') {
  out('${SECRET_USERNAME}');
} else if (cmd === 'get' && sub === 'exposed') {
  out('3');
} else if (cmd === 'get' && sub === 'attachment') {
  out('${SECRET_PASSPORT}-raw-attachment-bytes');
} else if (cmd === 'get' && sub === 'item' && args[2] === 'key-openai') {
  out({
    id: 'key-openai',
    name: 'OpenAI Prod',
    type: 100,
    apiKey: {
      value: '${SECRET_API_KEY}',
      sendStyle: 'bearer',
      allowedHosts: ['api.openai.com'],
      headerName: null,
      basicUsername: 'api-admin-user'
    }
  });
} else if (cmd === 'get' && sub === 'item' && args[2] === 'item-gh') {
  out({
    id: 'item-gh',
    name: 'GitHub',
    type: 1,
    login: { username: '${SECRET_USERNAME}', password: 'old' }
  });
} else if (cmd === 'edit' && sub === 'item') {
  const decoded = JSON.parse(Buffer.from(args[3], 'base64').toString('utf8'));
  out({ id: args[2], name: decoded.name, type: 1, login: decoded.login });
} else if (cmd === 'create' && sub === 'item') {
  const decoded = JSON.parse(Buffer.from(args[2], 'base64').toString('utf8'));
  out({ id: 'created-item-99', name: decoded.name, type: decoded.type, login: decoded.login });
} else if (cmd === 'generate') {
  out('${SECRET_GENERATED}');
} else if (cmd === 'send' && (sub === 'list' || sub === 'get' || sub === 'create')) {
  const sendObj = {
    id: 'send-42',
    accessId: 'acc-42',
    accessUrl: 'https://vault.vowkey.app/#/send/acc-42/public',
    name: 'Client wire note',
    type: 0,
    disabled: false,
    password: '${SECRET_SEND_PASSWORD}',
    notes: 'Private office note',
    key: 'raw-send-key',
    text: { text: '${SECRET_SEND_TEXT}', hidden: true }
  };
  out(sub === 'list' ? [sendObj] : sendObj);
} else {
  process.stderr.write('unexpected error at https://admin:${SECRET_PASSWORD}@example.com?token=${SECRET_QUERY_TOKEN} with ${SECRET_API_KEY}');
  process.exit(1);
}
`;

const ALL_SECRETS = [
  SECRET_PASSWORD,
  SECRET_PASSPORT,
  SECRET_API_KEY,
  SECRET_SEND_TEXT,
  SECRET_SEND_PASSWORD,
  SECRET_QUERY_TOKEN,
  SECRET_USERNAME,
  SECRET_GENERATED,
  'OldPassword!111',
  'raw-attachment-encryption-key-secret',
  'raw-send-key',
  'raw-broker-secret-never-leak',
  'api-admin-user',
];

function expectZeroLeaks(serialized: string) {
  for (const secret of ALL_SECRETS) {
    expect(serialized).not.toContain(secret);
  }
}

describe('MCP tool responses keep saved values out of agent context', () => {
  let tempDir: string;
  const origCli = process.env['VOWKEY_CLI_PATH'];
  const origDirs = process.env['VOWKEY_ALLOWED_DIRECTORIES'];
  const origCliData = process.env['VOWKEYCLI_APPDATA_DIR'];
  const origAgentCred = process.env['VOWKEY_AGENT_CREDENTIAL'];

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vk-zero-leak-'));
    const cliScript = path.join(tempDir, 'fake-vowkey.js');
    fs.writeFileSync(cliScript, FAKE_CLI, 'utf8');
    process.env['VOWKEY_CLI_PATH'] = cliScript;
    process.env['VOWKEY_ALLOWED_DIRECTORIES'] = tempDir;
    process.env['VOWKEYCLI_APPDATA_DIR'] = path.join(tempDir, 'cli-data');
    delete process.env['VOWKEY_AGENT_CREDENTIAL'];
    _resetBwInvocationCacheForTests();
  });

  afterAll(() => {
    if (origCli === undefined) delete process.env['VOWKEY_CLI_PATH'];
    else process.env['VOWKEY_CLI_PATH'] = origCli;
    if (origDirs === undefined)
      delete process.env['VOWKEY_ALLOWED_DIRECTORIES'];
    else process.env['VOWKEY_ALLOWED_DIRECTORIES'] = origDirs;
    if (origCliData === undefined) delete process.env['VOWKEYCLI_APPDATA_DIR'];
    else process.env['VOWKEYCLI_APPDATA_DIR'] = origCliData;
    if (origAgentCred === undefined)
      delete process.env['VOWKEY_AGENT_CREDENTIAL'];
    else process.env['VOWKEY_AGENT_CREDENTIAL'] = origAgentCred;
    _resetBwInvocationCacheForTests();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const text = (r: { content: Array<{ text?: string }> }) =>
    r.content[0]?.text ?? '';

  it('1) sync_env_file writes resolved secrets to disk and returns only key names, count, and @vk: preview', async () => {
    const templatePath = path.join(tempDir, '.env.template');
    const targetEnvPath = path.join(tempDir, '.env.local');
    fs.writeFileSync(
      templatePath,
      '# App secrets\nOPENAI_API_KEY=@vk:key-openai/key.value\n',
      'utf8',
    );

    const res = await handleSyncEnvFile({
      templatePath,
      path: targetEnvPath,
    });
    expect(res.isError).toBe(false);
    const body = text(res);
    expectZeroLeaks(body);
    expect(JSON.parse(body)).toEqual({
      synced: 1,
      keys: ['OPENAI_API_KEY'],
      path: targetEnvPath,
      state: 'written',
      preview: {
        OPENAI_API_KEY: '@vk:key-openai/key.value',
      },
    });

    // Disk file received the real secret directly inside the tool process
    const diskContent = fs.readFileSync(targetEnvPath, 'utf8');
    expect(diskContent).toContain(`OPENAI_API_KEY=${SECRET_API_KEY}`);
  });

  it('2) get & get attachment never return raw passwords, usernames, query tokens, or attachment bytes', async () => {
    const attOut = path.join(tempDir, 'downloads') + path.sep;
    const attRes = await handleGet({
      object: 'attachment',
      id: 'passport.pdf',
      itemid: 'item-prof',
      output: attOut,
    });
    expect(attRes.isError).toBe(false);
    expectZeroLeaks(text(attRes));
    expect(JSON.parse(text(attRes))).toMatchObject({
      object: 'attachment',
      itemId: 'item-prof',
      attachment: 'passport.pdf',
      reference: '@vk:item-prof/attachment.passport.pdf',
    });

    const uriRes = await handleGet({ object: 'uri', id: 'item-gh' });
    expectZeroLeaks(text(uriRes));
    expect(JSON.parse(text(uriRes))).toEqual({
      itemId: 'item-gh',
      object: 'uri',
      uri: 'https://dashboard.stripe.com',
      domain: 'dashboard.stripe.com',
      reference: '@vk:item-gh/login.uri',
    });

    const pwRes = await handleGet({ object: 'password', id: 'item-gh' });
    expectZeroLeaks(text(pwRes));
    expect(JSON.parse(text(pwRes)).reference).toBe(
      '@vk:item-gh/login.password',
    );

    const userRes = await handleGet({ object: 'username', id: 'item-gh' });
    expectZeroLeaks(text(userRes));
    expect(JSON.parse(text(userRes)).reference).toBe(
      '@vk:item-gh/login.username',
    );

    const keyRes = await handleGet({ object: 'item', id: 'key-openai' });
    expectZeroLeaks(text(keyRes));
    expect(JSON.parse(text(keyRes)).apiKey.basicUsername).toBe(
      '@vk:key-openai/key.basicUsername',
    );
  });

  it('3) list_send, get_send, and create_text_send redact Send text, password, notes, and keys while keeping vowkey.app share URL', async () => {
    const listRes = await handleListSend({});
    const getRes = await handleGetSend({ id: 'send-42' });
    const createRes = await handleCreateTextSend({
      name: 'Client wire note',
      text: SECRET_SEND_TEXT,
      password: SECRET_SEND_PASSWORD,
    });

    for (const r of [listRes, getRes, createRes]) {
      expect(r.isError).toBe(false);
      expectZeroLeaks(text(r));
    }

    const parsed = JSON.parse(text(getRes));
    expect(parsed).toMatchObject({
      id: 'send-42',
      accessUrl: 'https://vault.vowkey.app/#/send/acc-42/public',
      passwordProtected: true,
      notes: '@vk:send-42/send.notes',
      text: {
        hidden: true,
        reference: '@vk:send-42/send.text',
      },
      reference: '@vk:send-42/send',
    });
  });

  it('4) generate stores in vault or returns masked preview + @vk: handle and never leaks generated passwords', async () => {
    const standalone = await handleGenerate({ length: 24 });
    expect(standalone.isError).toBe(false);
    expectZeroLeaks(text(standalone));
    const standaloneParsed = JSON.parse(text(standalone));
    expect(standaloneParsed.reference).toBe(
      '@vk:created-item-99/login.password',
    );
    expect(standaloneParsed.preview).toBe('••••••••••••');

    const rotated = await handleGenerate({ length: 24, itemId: 'item-gh' });
    expect(rotated.isError).toBe(false);
    expectZeroLeaks(text(rotated));
    expect(JSON.parse(text(rotated)).reference).toBe(
      '@vk:item-gh/login.password',
    );
  });

  it('5) list items & org-members keep item names and clean domains while redacting usernames, query tokens, and PII', async () => {
    const itemsRes = await handleList({ type: 'items' });
    expect(itemsRes.isError).toBe(false);
    const itemsBody = text(itemsRes);
    expectZeroLeaks(itemsBody);

    const parsedItems = JSON.parse(itemsBody);
    expect(parsedItems[0].name).toBe('GitHub');
    expect(parsedItems[0].login.username).toBe('@vk:item-gh/login.username');
    expect(parsedItems[0].login.password).toBe('@vk:item-gh/login.password');
    expect(parsedItems[0].login.uri).toBe('https://github.com');
    expect(parsedItems[0].login.uris[0]).toEqual({
      uri: 'https://github.com',
      domain: 'github.com',
      match: 0,
    });
    expect(parsedItems[0].passwordHistory[0].password).toBe(
      '@vk:item-gh/passwordHistory.0',
    );
    expect(parsedItems[0].attachments[0].url).toBeUndefined();
    expect(parsedItems[0].attachments[0].reference).toBe(
      '@vk:item-gh/attachment.att-1',
    );

    const membersRes = await handleList({
      type: 'org-members',
      organizationid: 'org-1',
    });
    expectZeroLeaks(text(membersRes));
    expect(JSON.parse(text(membersRes))[0].email).toBe(
      '@vk:mem-1/member.email',
    );
  });



});
