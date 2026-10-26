import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  _resetBwInvocationCacheForTests,
  resolveBwInvocation,
} from '../../src/utils/vowkey-cli.js';

const originalPlatform = process.platform;
const originalEnv = { ...process.env };

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform });
}

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vowkey-cli-test-'));
}

describe('resolveBwInvocation', () => {
  let tmpDirs: string[] = [];

  beforeEach(() => {
    _resetBwInvocationCacheForTests();
    tmpDirs = [];
    delete process.env['VOWKEY_CLI_PATH'];
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    process.env = { ...originalEnv };
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    _resetBwInvocationCacheForTests();
  });

  function tempDir(): string {
    const dir = makeTempDir();
    tmpDirs.push(dir);
    return dir;
  }

  it('returns a bare `vowkey` on POSIX with no override (PATH/execvp handles it)', () => {
    setPlatform('linux');
    expect(resolveBwInvocation()).toEqual({ command: 'vowkey', prefixArgs: [] });
  });

  it('runs a JS entry point via the current Node runtime when VOWKEY_CLI_PATH is a .js file', () => {
    setPlatform('linux');
    const dir = tempDir();
    const jsEntry = path.join(dir, 'vowkey.js');
    fs.writeFileSync(jsEntry, '// fake cli');
    process.env['VOWKEY_CLI_PATH'] = jsEntry;

    expect(resolveBwInvocation()).toEqual({
      command: process.execPath,
      prefixArgs: [jsEntry],
    });
  });

  it('spawns a real executable directly when VOWKEY_CLI_PATH points at a binary', () => {
    setPlatform('linux');
    const dir = tempDir();
    const binary = path.join(dir, 'vowkey');
    fs.writeFileSync(binary, '#!/bin/sh\n');
    process.env['VOWKEY_CLI_PATH'] = binary;

    expect(resolveBwInvocation()).toEqual({
      command: binary,
      prefixArgs: [],
    });
  });

  it('Windows: resolves the npm .cmd shim to its JS entry run via Node', () => {
    setPlatform('win32');
    const prefix = tempDir();

    // Simulate the npm global layout: shim at <prefix>, package under
    // <prefix>/node_modules/@vowkey/cli.
    fs.writeFileSync(path.join(prefix, 'vowkey.cmd'), '@echo off\n');
    const pkgDir = path.join(prefix, 'node_modules', '@vowkey', 'cli');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({ bin: { vowkey: 'build/vowkey.js' } }),
    );
    const jsEntry = path.join(pkgDir, 'build', 'vowkey.js');
    fs.mkdirSync(path.dirname(jsEntry), { recursive: true });
    fs.writeFileSync(jsEntry, '// fake cli');

    process.env['PATH'] = prefix;
    // Lowercase to match the fixture filenames so the test is
    // deterministic on case-sensitive (Linux CI) and case-insensitive
    // (macOS) filesystems alike. Real Windows is case-insensitive.
    process.env['PATHEXT'] = '.com;.exe;.bat;.cmd';

    expect(resolveBwInvocation()).toEqual({
      command: process.execPath,
      prefixArgs: [jsEntry],
    });
  });

  it('Windows: prefers a real vowkey.exe over the .cmd shim', () => {
    setPlatform('win32');
    const prefix = tempDir();
    const exe = path.join(prefix, 'vowkey.exe');
    fs.writeFileSync(exe, 'MZ');
    fs.writeFileSync(path.join(prefix, 'vowkey.cmd'), '@echo off\n');

    process.env['PATH'] = prefix;
    // Lowercase to match the fixture filenames so the test is
    // deterministic on case-sensitive (Linux CI) and case-insensitive
    // (macOS) filesystems alike. Real Windows is case-insensitive.
    process.env['PATHEXT'] = '.com;.exe;.bat;.cmd';

    expect(resolveBwInvocation()).toEqual({ command: exe, prefixArgs: [] });
  });

  it('Windows: falls back to bare `vowkey` when nothing is found on PATH', () => {
    setPlatform('win32');
    process.env['PATH'] = tempDir(); // empty dir
    // Lowercase to match the fixture filenames so the test is
    // deterministic on case-sensitive (Linux CI) and case-insensitive
    // (macOS) filesystems alike. Real Windows is case-insensitive.
    process.env['PATHEXT'] = '.com;.exe;.bat;.cmd';

    expect(resolveBwInvocation()).toEqual({ command: 'vowkey', prefixArgs: [] });
  });

  it('memoizes the result across calls', () => {
    setPlatform('linux');
    const first = resolveBwInvocation();
    const second = resolveBwInvocation();
    expect(second).toBe(first);
  });
});
