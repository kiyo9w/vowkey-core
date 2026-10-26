/**
 * CLI command execution utilities
 */

import { spawn } from 'child_process';
import { resolveBwInvocation } from './vowkey-cli.js';
import { buildBwChildEnv } from './vowkey-env.js';
import { buildSafeCommand, isValidVowkeyCommand } from './security.js';
import type { CliResponse } from './types.js';

/**
 * Executes a Vowkey CLI command safely using spawn() to prevent command injection
 * Internally calls buildSafeCommand() to validate and sanitize inputs
 * @param baseCommand - The base Vowkey command (e.g., 'list', 'get', 'create')
 * @param parameters - Array of command parameters (will be validated)
 * @returns Promise resolving to CLI response with output or error
 */
export async function executeCliCommand(
  baseCommand: string,
  parameters: readonly string[] = [],
): Promise<CliResponse> {
  try {
    // Build safe command array (validates and sanitizes inputs)
    const [command, ...args] = buildSafeCommand(baseCommand, parameters);

    // Validate the base command against allowlist
    if (!isValidVowkeyCommand(command)) {
      return {
        errorOutput:
          'Invalid or unsafe command. Only Vowkey CLI commands are allowed.',
      } as const;
    }

    // Build a filtered child env. `vowkey` only needs PATH/HOME/APPDATA-style
    // vars plus VOWKEY_SESSION when set — it must not inherit the API client
    // credentials or any other host env the operator set on the MCP
    // server process. See vowkey-env.ts for the full rationale.
    const childEnv = buildBwChildEnv(
      process.env['VOWKEY_SESSION']
        ? { VOWKEY_SESSION: process.env['VOWKEY_SESSION'] }
        : undefined,
    );

    // Resolve how to invoke `vowkey` (handles the Windows npm-shim case where
    // a bare `vowkey` is not directly spawnable). See vowkey-cli.ts.
    const { command: bwExecutable, prefixArgs } = resolveBwInvocation();

    // Use spawn with array of arguments to avoid shell interpretation
    return new Promise<CliResponse>((resolve) => {
      const child = spawn(bwExecutable, [...prefixArgs, command, ...args], {
        env: childEnv,
        shell: false, // Explicitly disable shell to prevent injection
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('error', (error: Error) => {
        resolve({
          errorOutput: `Failed to execute command: ${error.message}`,
        });
      });

      child.on('close', (code: number) => {
        const result: CliResponse = {};
        if (stdout) result.output = stdout.trim();
        if (stderr || code !== 0)
          result.errorOutput =
            stderr.trim() || `Command exited with code ${code}`;
        resolve(result);
      });
    });
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error occurred';

    return {
      errorOutput: errorMessage,
    } as const;
  }
}
