/**
 * Zero-configuration discovery of Vowkey Desktop / CLI agent broker and pairing credentials.
 * Reads `com.vowkey.agent.json` when present so external AI agents connect without manual paths.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface AgentDiscoveryManifest {
  name?: string;
  protocol?: string;
  cliDataDirectory?: string;
  socketPath?: string;
  credentialFile?: string;
  nativeHostPath?: string;
  cliPath?: string | null;
}

export function resolveDefaultCliDataDirectory(): string {
  if (process.env['VOWKEYCLI_APPDATA_DIR']) {
    return path.resolve(process.env['VOWKEYCLI_APPDATA_DIR']);
  }
  const home = process.env['HOME'] || os.homedir();
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Vowkey CLI');
  }
  if (process.platform === 'win32') {
    const appData =
      process.env['APPDATA'] || path.join(home, 'AppData', 'Roaming');
    return path.join(appData, 'Vowkey CLI');
  }
  if (process.env['XDG_CONFIG_HOME']) {
    return path.join(process.env['XDG_CONFIG_HOME'], 'Vowkey CLI');
  }
  return path.join(home, '.config', 'Vowkey CLI');
}

export function computeAgentSocketPath(cliDataDirectory: string): string {
  if (process.platform === 'win32') {
    const user = crypto
      .createHash('sha256')
      .update(`${process.env['USERDOMAIN'] ?? ''}\\${os.userInfo().username}`)
      .digest('hex')
      .slice(0, 16);
    return `\\\\.\\pipe\\vowkey-agent-${user}`;
  }
  return path.join(cliDataDirectory, 'agent', 'agent.sock');
}

export function readAgentDiscoveryManifest(
  cliDataDir = resolveDefaultCliDataDirectory(),
): AgentDiscoveryManifest | null {
  const candidates = [path.join(cliDataDir, 'com.vowkey.agent.json')];
  const home = process.env['HOME'] || os.homedir();
  if (process.platform === 'darwin') {
    candidates.push(
      path.join(
        home,
        'Library',
        'Application Support',
        'Vowkey',
        'com.vowkey.agent.json',
      ),
    );
  } else if (process.platform === 'win32' && process.env['APPDATA']) {
    candidates.push(
      path.join(
        process.env['APPDATA'],
        'Vowkey',
        'browsers',
        'com.vowkey.agent.json',
      ),
    );
  } else if (process.platform === 'linux') {
    candidates.push(
      path.join(home, '.config', 'Vowkey', 'com.vowkey.agent.json'),
    );
  }

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        const parsed = JSON.parse(
          fs.readFileSync(candidate, 'utf8'),
        ) as AgentDiscoveryManifest;
        if (parsed && typeof parsed === 'object') {
          return parsed;
        }
      }
    } catch {
      // Ignore unreadable manifest candidates.
    }
  }
  return null;
}

export interface ResolvedAgentEndpoint {
  cliDataDirectory: string;
  socketPath: string;
  credentialFile: string | null;
  defaultCredentialFile: string;
  brokerLikelyAvailable: boolean;
}

export function resolveAgentEndpoint(): ResolvedAgentEndpoint {
  const baseDir = resolveDefaultCliDataDirectory();
  const manifest = readAgentDiscoveryManifest(baseDir);
  const cliDataDirectory =
    typeof manifest?.cliDataDirectory === 'string' && manifest.cliDataDirectory
      ? manifest.cliDataDirectory
      : baseDir;
  const socketPath =
    typeof manifest?.socketPath === 'string' && manifest.socketPath
      ? manifest.socketPath
      : computeAgentSocketPath(cliDataDirectory);
  const defaultCredentialFile =
    typeof manifest?.credentialFile === 'string' && manifest.credentialFile
      ? manifest.credentialFile
      : path.join(cliDataDirectory, 'agent', 'mcp-pairing.json');

  const explicitEnv = process.env['VOWKEY_AGENT_CREDENTIAL'];
  let credentialFile: string | null = null;
  if (explicitEnv != null && explicitEnv.trim() !== '') {
    credentialFile = explicitEnv.trim();
  } else if (fs.existsSync(defaultCredentialFile)) {
    credentialFile = defaultCredentialFile;
  }

  const brokerLikelyAvailable =
    process.platform === 'win32'
      ? manifest != null
      : fs.existsSync(socketPath) || manifest != null;

  return {
    cliDataDirectory,
    socketPath,
    credentialFile,
    defaultCredentialFile,
    brokerLikelyAvailable,
  };
}
