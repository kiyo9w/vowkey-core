import { ChildProcess, spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";

import { Response } from "../models/response";

import { DotenvError } from "./dotenv";
import { SecretsError } from "./errors";
import { SecretMasker } from "./masker";
import { ReferenceResolver, resolveRunEnvironment, RunEnvironmentError } from "./run-environment";
import type { EnvironmentMemberDescriptor } from "./run-environment";

export interface RunOptions {
  envFile?: string[];
  environment?: string[];
  /** Commander sets this to false for --no-masking. */
  masking?: boolean;
  proxy?: boolean;
  /** Commander sets this to false for --no-ca-trust. */
  caTrust?: boolean;
}

/** What `--proxy` needs from the secrets owner. */
export interface ProxyHandle {
  port: number;
  credential: string;
  /** The device CA certificate, PEM. */
  caCertificatePath: string;
  /** A bundle of the machine's roots plus the device CA, for tools that replace rather than add. */
  makeBundle(existingBundlePath: string | undefined): Promise<string>;
  /** Removes what was made for one run. */
  release?: () => void;
}

export interface RunDependencies {
  /** Resolves one `@vk:` reference to its value. */
  resolve: ReferenceResolver;
  /** Reads an environment item's members, by id or exact name. */
  environmentMembers: (idOrName: string) => Promise<EnvironmentMemberDescriptor[]>;
  /** Starts the proxy through the secrets owner and returns how to reach it. */
  startProxy?: () => Promise<ProxyHandle>;
  parentEnv?: NodeJS.ProcessEnv;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  /** Where signals are listened for. */
  signalSource?: NodeJS.Process;
}

const FORWARDED_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

export class RunCommand {
  constructor(private readonly deps: RunDependencies) {}

  /**
   * Resolves the environment, starts the command, and returns its exit status. A failure before
   * the command starts is an error response and nothing is spawned.
   */
  async run(argv: string[], options: RunOptions): Promise<Response | { exitCode: number }> {
    if (argv.length === 0) {
      return Response.error("No command to run. Use: vowkey run [options] -- <command> [args...]");
    }
    const parentEnv = this.deps.parentEnv ?? process.env;

    let resolved;
    try {
      const envFileTexts = (options.envFile ?? []).map((p) => readEnvFile(p));
      const environments: EnvironmentMemberDescriptor[][] = [];
      for (const id of options.environment ?? []) {
        environments.push(await this.deps.environmentMembers(id));
      }
      resolved = await resolveRunEnvironment({
        parentEnv,
        envFileTexts,
        environments,
        resolve: this.deps.resolve,
      });
    } catch (e) {
      if (
        e instanceof RunEnvironmentError ||
        e instanceof DotenvError ||
        e instanceof SecretsError
      ) {
        return Response.error(e.message);
      }
      throw e;
    }

    const env = { ...resolved.env };
    if (options.proxy) {
      if (this.deps.startProxy == null) {
        return Response.error("The proxy is not available here.");
      }
      try {
        Object.assign(env, await proxyEnvironment(await this.deps.startProxy(), env, options));
      } catch (e) {
        return Response.error(e instanceof Error ? e.message : "The proxy could not start.");
      }
    }

    const masking = options.masking !== false;
    return { exitCode: await this.spawnAndWait(argv, env, masking ? resolved.secrets : null) };
  }

  private spawnAndWait(argv: string[], env: Record<string, string>, secrets: string[] | null) {
    const stdout = this.deps.stdout ?? process.stdout;
    const stderr = this.deps.stderr ?? process.stderr;
    const signalSource = this.deps.signalSource ?? process;

    return new Promise<number>((resolve) => {
      const child: ChildProcess = spawn(argv[0], argv.slice(1), {
        env,
        stdio: secrets == null ? "inherit" : ["inherit", "pipe", "pipe"],
        shell: false,
      });

      const forwards = FORWARDED_SIGNALS.map((signal) => {
        const handler = () => {
          child.kill(signal);
        };
        signalSource.on(signal, handler);
        return { signal, handler };
      });
      const cleanup = () => {
        for (const { signal, handler } of forwards) {
          signalSource.removeListener(signal, handler);
        }
      };

      let streamsOpen = 0;
      let exit: number | null = null;
      const finish = () => {
        if (exit != null && streamsOpen === 0) {
          cleanup();
          resolve(exit);
        }
      };

      if (secrets != null) {
        const pipe = (from: NodeJS.ReadableStream | null, to: NodeJS.WritableStream) => {
          if (from == null) {
            return;
          }
          streamsOpen++;
          const masker = new SecretMasker(secrets);
          from.on("data", (chunk: Buffer) => {
            const safe = masker.push(chunk);
            if (safe.length > 0) {
              to.write(safe);
            }
          });
          from.on("end", () => {
            const rest = masker.flush();
            if (rest.length > 0) {
              to.write(rest);
            }
            streamsOpen--;
            finish();
          });
        };
        pipe(child.stdout, stdout);
        pipe(child.stderr, stderr);
      }

      child.on("error", (error: NodeJS.ErrnoException) => {
        stderr.write(
          error.code === "ENOENT"
            ? `vowkey run: ${argv[0]}: command not found\n`
            : `vowkey run: ${argv[0]}: ${error.message}\n`,
        );
        exit = error.code === "ENOENT" ? 127 : 126;
        streamsOpen = 0;
        finish();
      });
      child.on("close", (code, signal) => {
        if (exit == null) {
          exit = signal != null ? 128 + (os.constants.signals[signal] ?? 0) : (code ?? 1);
        }
        finish();
      });
    });
  }
}

function readEnvFile(path: string): string {
  try {
    const stat = fs.statSync(path);
    if (stat.size > 1024 * 1024) {
      throw new DotenvError(`${path}: the file is larger than 1 MiB`);
    }
    return fs.readFileSync(path, "utf8");
  } catch (e) {
    if (e instanceof DotenvError) {
      throw e;
    }
    throw new SecretsError("unavailable", `Could not read ${path}.`);
  }
}

async function proxyEnvironment(
  proxy: ProxyHandle,
  env: Record<string, string>,
  options: RunOptions,
): Promise<Record<string, string>> {
  const url = `http://vowkey:${proxy.credential}@127.0.0.1:${proxy.port}`;
  const out: Record<string, string> = {
    HTTP_PROXY: url,
    HTTPS_PROXY: url,
    NODE_USE_ENV_PROXY: "1",
  };
  if (options.caTrust === false) {
    return out;
  }
  const bundle = await proxy.makeBundle(env["SSL_CERT_FILE"]);
  out["SSL_CERT_FILE"] = bundle;
  out["REQUESTS_CA_BUNDLE"] = bundle;
  out["CURL_CA_BUNDLE"] = bundle;
  out["GIT_SSL_CAINFO"] = bundle;
  out["NODE_EXTRA_CA_CERTS"] = proxy.caCertificatePath;
  return out;
}
