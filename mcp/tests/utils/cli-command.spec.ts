import { afterEach, describe, expect, it } from '@jest/globals';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { executeCliCommand } from '../../src/utils/cli.js';
import { _resetBwInvocationCacheForTests } from '../../src/utils/vowkey-cli.js';

describe('CLI command execution', () => {
  const originalCliPath = process.env['VOWKEY_CLI_PATH'];
  let tempDir: string | undefined;

  afterEach(() => {
    if (originalCliPath === undefined) {
      delete process.env['VOWKEY_CLI_PATH'];
    } else {
      process.env['VOWKEY_CLI_PATH'] = originalCliPath;
    }
    _resetBwInvocationCacheForTests();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  it('closes child stdin for non-interactive CLI commands', async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'vowkey-cli-'));
    const fakeCli = path.join(tempDir, 'fake-cli.mjs');
    writeFileSync(
      fakeCli,
      [
        'let stdinEnded = false;',
        'process.stdin.resume();',
        "process.stdin.once('end', () => { stdinEnded = true; });",
        "setTimeout(() => { console.log(JSON.stringify({ stdinEnded })); process.exit(0); }, 50);",
      ].join('\n'),
    );
    process.env['VOWKEY_CLI_PATH'] = fakeCli;
    _resetBwInvocationCacheForTests();

    const result = await executeCliCommand('list', ['items']);

    expect(result.errorOutput).toBeUndefined();
    expect(JSON.parse(result.output ?? '{}')).toEqual({ stdinEnded: true });
  }, 10_000);
});
