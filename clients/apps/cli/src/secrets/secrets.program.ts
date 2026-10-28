import * as path from "path";

import { Command, program } from "commander";

import { BaseProgram } from "../base-program";
import { Response } from "../models/response";
import { StringResponse } from "../models/response/string.response";

import { writeChildBundle } from "./ca-bundle";
import { resolveCliDataDirectory } from "./data-directory";
import { DeviceCa } from "./device-ca";
import { SecretsError } from "./errors";
import { SecretsOwner } from "./owner";
import { askOwner, ensureUnlockedOwner, ownerStatus } from "./owner-client";
import { RunCommand } from "./run.command";
import type { ProxyHandle } from "./run.command";
import { trustDeviceCa } from "./trust";
import { VaultResolver } from "./vault-resolver";

const collect = (value: string, previous: string[]) => [...previous, value];

/** Prints a result as one line of JSON, without an `object` marker. */
function json(value: unknown): Response {
  return Response.success(new StringResponse(JSON.stringify(value)));
}

function failure(e: unknown): Response {
  if (e instanceof SecretsError) {
    return Response.error(`${e.code}: ${e.message}`);
  }
  return Response.error(e instanceof Error ? e.message : "The request failed.");
}

export class SecretsProgram extends BaseProgram {
  async register() {
    program
      .addCommand(this.runCommand())
      .addCommand(this.envCommand())
      .addCommand(this.proxyCommand())
      .addCommand(this.secretsCommand());
  }

  protected resolver(): VaultResolver {
    return new VaultResolver(
      this.serviceContainer.cipherService,
      this.serviceContainer.accountService,
    );
  }

  // ---- vowkey run --------------------------------------------------------------------------

  private runCommand(): Command {
    return new Command("run")
      .description("Run a command with the keys it needs resolved into its environment.")
      .argument("[command...]", "The command and its arguments, after --.")
      .option("--env-file <path>", "A dotenv file whose @vk: references are resolved.", collect, [])
      .option(
        "--environment <id>",
        "An environment, by id or name, whose keys are resolved.",
        collect,
        [],
      )
      .option("--no-masking", "Do not conceal resolved values in the command's output.")
      .option("--proxy", "Send the command's HTTP requests through the key proxy.")
      .option("--no-ca-trust", "With --proxy, do not point the command at the proxy's certificate.")
      .allowExcessArguments(true)
      .on("--help", () => {
        const w = (line: string) => process.stdout.write(line + "\n");
        w("\n  Examples:\n");
        w("    vowkey run --environment production -- node server.js");
        w("    vowkey run --env-file .env -- docker compose up");
        w("    vowkey run --no-masking -- sh -c 'echo $OPENAI_API_KEY'");
        w("");
        w("  Precedence, lowest first: this shell's environment, each --env-file in order,");
        w("  each --environment in order. The command never receives the vault session.");
      })
      .action(async (argv: string[], options) => {
        if (argv.length === 0) {
          this.processResponse(
            Response.error("No command to run. Use: vowkey run [options] -- <command> [args...]"),
            true,
          );
          return;
        }
        await this.exitIfLocked();
        const resolver = this.resolver();
        let release: (() => void) | undefined;
        const command = new RunCommand({
          resolve: resolver.resolve,
          environmentMembers: resolver.environmentMembers,
          startProxy: async () => {
            const handle = await this.startProxyHandle();
            release = handle.release;
            return handle;
          },
        });
        const result = await command.run(argv, options);
        release?.();
        if (result instanceof Response) {
          this.processResponse(result);
        } else {
          process.exitCode = result.exitCode;
        }
      });
  }

  private async startProxyHandle(): Promise<ProxyHandle & { release: () => void }> {
    await ensureUnlockedOwner();
    await askOwner({ type: "proxy-start" });
    const info = await askOwner({ type: "proxy-info" });
    const directory = resolveCliDataDirectory();
    const caFile = path.join(directory, "proxy-ca", "proxy-ca.crt");
    const bundles: { remove: () => void }[] = [];
    return {
      port: info.port as number,
      credential: info.credential as string,
      caCertificatePath: caFile,
      makeBundle: async (existing) => {
        const bundle = writeChildBundle(
          path.join(directory, "proxy-bundles"),
          info.caCertificate as string,
          existing,
        );
        bundles.push(bundle);
        return bundle.file;
      },
      release: () => bundles.forEach((b) => b.remove()),
    };
  }

  // ---- vowkey env --------------------------------------------------------------------------

  private envCommand(): Command {
    const env = new Command("env").description(
      "Write an environment's keys to a regular file, or list them as references.",
    );
    env.addCommand(
      new Command("file")
        .description("Enable or disable the resolved .env file for an environment on this device.")
        .requiredOption("--environment <id>", "The environment, by id or name.")
        .option("--path <path>", "Where the file is written. Needed with --enable.")
        .option("--enable", "Write the file while the vault is unlocked.")
        .option("--disable", "Remove the file Vowkey wrote.")
        .on("--help", () => {
          const w = (line: string) => process.stdout.write(line + "\n");
          w("\n  The file is a regular file with the resolved values in it. It exists while the");
          w("  environment is enabled and the vault is unlocked, and is removed on lock, disable,");
          w("  logout or when access is lost. Copies and snapshots of it are not removed.\n");
        })
        .action(async (options) => {
          if (options.enable === options.disable) {
            this.processResponse(
              Response.badRequest("Use exactly one of --enable and --disable."),
              true,
            );
            return;
          }
          if (options.enable && !options.path) {
            this.processResponse(Response.badRequest("--enable needs --path."), true);
            return;
          }
          try {
            if (options.enable) {
              await this.exitIfLocked();
              await ensureUnlockedOwner();
            } else if ((await ownerStatus()) == null) {
              this.processResponse(
                Response.error("unavailable: No secrets owner is running."),
                true,
              );
              return;
            }
            const reply = await askOwner(
              options.enable
                ? { type: "enable", environment: options.environment, path: options.path }
                : { type: "disable", environment: options.environment },
            );
            const row = reply.environment as {
              environmentId: string;
              enabled: boolean;
              path: string;
              state: string;
            };
            this.processResponse(
              json({
                environmentId: row.environmentId,
                enabled: row.enabled,
                path: row.path,
                state: row.state,
              }),
            );
          } catch (e) {
            this.processResponse(failure(e));
          }
        }),
    );
    env.addCommand(
      new Command("references")
        .description("Print NAME=@vk:<keyItemId>/key.value for each key in an environment.")
        .requiredOption("--environment <id>", "The environment, by id or name.")
        .action(async (options) => {
          await this.exitIfLocked();
          try {
            const members = await this.resolver().environmentMembers(options.environment);
            const lines = members.map((m) => `${m.name}=@vk:${m.itemId}/key.value`);
            this.processResponse(Response.success(new StringResponse(lines.join("\n"))));
          } catch (e) {
            this.processResponse(failure(e));
          }
        }),
    );
    return env;
  }

  // ---- vowkey proxy ------------------------------------------------------------------------

  private proxyCommand(): Command {
    const proxy = new Command("proxy").description(
      "A loopback proxy that attaches a key to requests for that key's hosts.",
    );
    proxy.addCommand(
      new Command("start")
        .description("Listen on 127.0.0.1 for the keys turned on for the proxy.")
        .option("--port <port>", "The port to listen on.", "47623")
        .action(async (options) => {
          await this.exitIfLocked();
          try {
            await ensureUnlockedOwner();
            const reply = await askOwner({ type: "proxy-start", port: Number(options.port) });
            this.processResponse(json(reply.proxy));
          } catch (e) {
            this.processResponse(failure(e));
          }
        }),
    );
    proxy.addCommand(
      new Command("stop")
        .description("Stop listening and close every open connection.")
        .action(async () => {
          try {
            if ((await ownerStatus()) == null) {
              this.processResponse(json({ listening: false, host: "127.0.0.1", port: 47623 }));
              return;
            }
            const reply = await askOwner({ type: "proxy-stop" });
            this.processResponse(json(reply.proxy));
          } catch (e) {
            this.processResponse(failure(e));
          }
        }),
    );
    proxy.addCommand(
      new Command("status").description("Whether the proxy is listening.").action(async () => {
        const status = await ownerStatus();
        this.processResponse(
          json(status?.proxy ?? { listening: false, host: "127.0.0.1", port: 47623 }),
        );
      }),
    );
    proxy.addCommand(
      new Command("enable")
        .description("Turn a key on for the proxy.")
        .argument("<itemId>", "The key's item id.")
        .action(async (itemId: string) => {
          await this.exitIfLocked();
          try {
            await ensureUnlockedOwner();
            await askOwner({ type: "proxy-enable-key", itemId });
            this.processResponse(json({ itemId, enabled: true }));
          } catch (e) {
            this.processResponse(failure(e));
          }
        }),
    );
    proxy.addCommand(
      new Command("disable")
        .description("Turn a key off for the proxy.")
        .argument("<itemId>", "The key's item id.")
        .action(async (itemId: string) => {
          try {
            if ((await ownerStatus()) == null) {
              this.processResponse(json({ itemId, enabled: false }));
              return;
            }
            await askOwner({ type: "proxy-disable-key", itemId });
            this.processResponse(json({ itemId, enabled: false }));
          } catch (e) {
            this.processResponse(failure(e));
          }
        }),
    );
    proxy.addCommand(
      new Command("trust")
        .description("Add the proxy certificate to your user trust store, or remove it.")
        .option("--remove", "Remove the certificate you added.")
        .on("--help", () => {
          const w = (line: string) => process.stdout.write(line + "\n");
          w("\n  This trusts the certificate for every app you run and every host, not only the");
          w("  hosts of your keys, and it stays until you run this again with --remove.");
          w(
            "  `vowkey run --proxy` does not need it: it hands the certificate to that command alone.\n",
          );
        })
        .action(async (options) => {
          try {
            const directory = path.join(resolveCliDataDirectory(), "proxy-ca");
            await DeviceCa.loadOrCreate(directory);
            const message = trustDeviceCa(
              path.join(directory, "proxy-ca.crt"),
              options.remove === true,
            );
            this.processResponse(Response.success(new StringResponse(message)));
          } catch (e) {
            this.processResponse(failure(e));
          }
        }),
    );
    return proxy;
  }

  // ---- vowkey secrets (the owner) ----------------------------------------------------------

  private secretsCommand(): Command {
    const secrets = new Command("secrets").description(
      "The process that keeps environment files and the proxy in step with the vault.",
    );
    secrets.addCommand(
      new Command("serve")
        .description("Run the owner in the foreground. It is started for you when it is needed.")
        .action(async () => {
          await this.exitIfLocked();
          const directory = resolveCliDataDirectory();
          const owner = new SecretsOwner(directory);
          let stop!: () => void;
          const stopped = new Promise<void>((resolve) => (stop = resolve));
          try {
            await owner.start(this.resolver(), stop);
          } catch (e) {
            this.processResponse(failure(e), true);
            return;
          }
          const interval = setInterval(() => {
            void this.serviceContainer.syncService
              .fullSync(false)
              .catch((): void => undefined)
              .then(() => owner.handle({ v: 1, id: "", type: "refresh" }))
              .catch((): void => undefined);
          }, 60_000);
          const quit = () => {
            void owner.shutdown().then(stop);
          };
          process.once("SIGTERM", quit);
          process.once("SIGINT", quit);
          await stopped;
          clearInterval(interval);
          process.exitCode = 0;
        }),
    );
    secrets.addCommand(
      new Command("status").description("Show what the owner is keeping.").action(async () => {
        const status = await ownerStatus();
        this.processResponse(
          status == null
            ? json({ running: false })
            : json({
                running: true,
                locked: status.locked,
                environments: status.environments,
                proxy: status.proxy,
              }),
        );
      }),
    );
    secrets.addCommand(
      new Command("stop")
        .description("Stop the owner. Managed files are removed.")
        .action(async () => {
          if ((await ownerStatus()) == null) {
            this.processResponse(json({ running: false }));
            return;
          }
          try {
            await askOwner({ type: "stop" });
            this.processResponse(json({ running: false }));
          } catch (e) {
            this.processResponse(failure(e));
          }
        }),
    );
    return secrets;
  }
}
