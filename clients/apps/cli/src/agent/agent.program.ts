import { deferred } from "@vowkey/common/platform/misc/deferred";
import { Command, program } from "commander";
import { AccountAgentAuthority } from "@vowkey/common/vault/agent/account-authority";
import { AgentBroker } from "@vowkey/common/vault/agent/node/broker";
import { RemoteTargets } from "@vowkey/common/vault/agent/node/remote-targets";

import { BaseProgram } from "../base-program";
import { Response } from "../models/response";
import { StringResponse } from "../models/response/string.response";
import { resolveCliDataDirectory } from "@vowkey/common/platform/misc/node/cli-data-directory";
import { VaultResolver } from "../secrets/vault-resolver";

import {
  accessResult,
  answerRequest,
  approvePair,
  listPending,
  pairAndWait,
  readForm,
  submitRequest,
} from "./client";

const collect = (value: string, previous: string[]) => [...previous, value];

function json(value: unknown): Response {
  return Response.success(new StringResponse(JSON.stringify(value)));
}

function protocolFailure(error: unknown): Response | null {
  if (!(error instanceof Error)) {
    return null;
  }
  const code = error.message.split(":")[0];
  if (
    code === "executor_unavailable" ||
    code === "credential_rejected" ||
    code === "unpaired" ||
    code === "malformed"
  ) {
    return json({ type: "error", code });
  }
  return null;
}

/** The local agent broker and the commands a paired client uses to reach it. */
export class AgentProgram extends BaseProgram {
  async register() {
    program.addCommand(this.agentCommand());
  }

  private agentCommand(): Command {
    const agent = new Command("agent").description(
      "Pair an agent once, then ask this machine before it fills a form.",
    );
    agent.addCommand(this.serveCommand());
    agent.addCommand(this.pairCommand());
    agent.addCommand(this.pendingCommand());
    agent.addCommand(this.approveCommand());
    agent.addCommand(this.requestCommand());
    agent.addCommand(this.answerCommand());
    agent.addCommand(this.resultCommand());
    agent.addCommand(
      new Command("read-form")
        .description("Read the fields of a form already collected by Vowkey, without its values.")
        .requiredOption("--credential-file <path>", "This client's pairing file.")
        .option("--target <id>", "A target returned by Vowkey.")
        .action(async (options: { credentialFile: string; target?: string }) => {
          try {
            this.processResponse(json(await readForm(
              resolveCliDataDirectory(), options.credentialFile, options.target,
            )));
          } catch (error) {
            this.processResponse(protocolFailure(error) ?? Response.error(error));
          }
        }),
    );
    return agent;
  }

  private serveCommand(): Command {
    return new Command("serve")
      .description("Run the broker for this account. A broker that is already running stays.")
      .action(async () => {
        await this.exitIfLocked();
        const directory = resolveCliDataDirectory();
        const resolver = new VaultResolver(
          this.serviceContainer.cipherService,
          this.serviceContainer.accountService,
        );
        const targets = new RemoteTargets();
        const authority = new AccountAgentAuthority(
          await resolver.userId(),
          this.serviceContainer.accountService,
          this.serviceContainer.keyService,
          this.serviceContainer.cipherService,
          this.serviceContainer.apiService,
          targets,
          await this.serviceContainer.appIdService.getAppId(),
        );
        const broker = new AgentBroker(directory, authority, targets);
        try {
          await broker.start();
        } catch (e) {
          this.processResponse(protocolFailure(e) ?? Response.error(e), true);
          return;
        }
        const stopped = deferred<void>();
        const quit = () => {
          void broker.stop().then(stopped.resolve, stopped.reject);
        };
        process.once("SIGINT", quit);
        process.once("SIGTERM", quit);
        await stopped.promise;
        process.exitCode = 0;
      });
  }

  private pairCommand(): Command {
    return new Command("pair")
      .description("Pair this client. The credential is written to the file and is not printed.")
      .requiredOption("--credential-file <path>", "Where this client's credential is stored.")
      .option("--name <name>", "The name shown when you approve the pair.", "Agent")
      .action(async (options: { credentialFile: string; name: string }) => {
        try {
          const paired = await pairAndWait(
            resolveCliDataDirectory(),
            options.credentialFile,
            options.name,
          );
          this.processResponse(json({ pairingId: paired.pairingId }));
        } catch (e) {
          this.processResponse(protocolFailure(e) ?? Response.error(e));
        }
      });
  }

  private pendingCommand(): Command {
    return new Command("pending")
      .description("List pairs waiting for approval. No credential is shown.")
      .action(async () => {
        try {
          this.processResponse(json({ pairs: await listPending(resolveCliDataDirectory()) }));
        } catch (e) {
          this.processResponse(protocolFailure(e) ?? Response.error(e));
        }
      });
  }

  private approveCommand(): Command {
    return new Command("approve")
      .description("Approve a pair that is waiting. The credential goes only to that client.")
      .requiredOption("--connection <id>", "The connection waiting to pair.")
      .action(async (options: { connection: string }) => {
        try {
          const approved = await approvePair(resolveCliDataDirectory(), options.connection);
          this.processResponse(json({ pairingId: approved.pairingId }));
        } catch (e) {
          this.processResponse(protocolFailure(e) ?? Response.error(e));
        }
      });
  }

  private requestCommand(): Command {
    return new Command("request")
      .description("Ask to fill fields that already name a reference. A missing reference is refused.")
      .requiredOption("--credential-file <path>", "This client's pairing file.")
      .requiredOption("--goal <text>", "What the fill is for, at most 140 characters.")
      .requiredOption("--reason <text>", "Why this fill is asked, at most 100 characters.")
      .option("--target <id>", "A form the broker has already collected.")
      .option(
        "--assignment <field=reference>",
        "A field and its @vk: reference. Repeat for each field.",
        collect,
        [],
      )
      .action(
        async (options: {
          credentialFile: string;
          goal: string;
          reason: string;
          target?: string;
          assignment: string[];
        }) => {
          const assignments = options.assignment.map((raw) => {
            const split = raw.indexOf("=");
            return {
              fieldId: split === -1 ? raw : raw.slice(0, split),
              reference: split === -1 ? undefined : raw.slice(split + 1),
            };
          });
          try {
            const reply = await submitRequest(resolveCliDataDirectory(), options.credentialFile, {
              goal: options.goal,
              reason: options.reason,
              targetId: options.target,
              assignments,
            });
            this.processResponse(json(reply));
          } catch (e) {
            this.processResponse(protocolFailure(e) ?? Response.error(e));
          }
        },
      );
  }

  private answerCommand(): Command {
    return new Command("answer")
      .description("Answer a request from this machine. The agent cannot answer for you.")
      .requiredOption("--request <id>", "The request to answer.")
      .option("--allow-once", "Allow this request.")
      .option("--always", "Allow this destination from now on.")
      .option("--deny", "Don't allow this request.")
      .option("--entry <id>", "An entry to include. Repeat for each one.", collect, [])
      .action(
        async (options: {
          request: string;
          allowOnce?: boolean;
          always?: boolean;
          deny?: boolean;
          entry: string[];
        }) => {
          const chosen = [options.allowOnce, options.always, options.deny].filter(Boolean);
          if (chosen.length !== 1) {
            this.processResponse(json({ type: "error", code: "malformed" }));
            return;
          }
          let answer: "allow_once" | "always_allow" | "deny" = "allow_once";
          if (options.deny) {
            answer = "deny";
          } else if (options.always) {
            answer = "always_allow";
          }
          try {
            const reply = await answerRequest(
              resolveCliDataDirectory(),
              options.request,
              answer,
              options.entry,
            );
            this.processResponse(json(reply));
          } catch (e) {
            this.processResponse(protocolFailure(e) ?? Response.error(e));
          }
        },
      );
  }

  private resultCommand(): Command {
    return new Command("result")
      .description("Read the outcome of a request this client sent.")
      .requiredOption("--credential-file <path>", "This client's pairing file.")
      .requiredOption("--request <id>", "The request to read.")
      .action(async (options: { credentialFile: string; request: string }) => {
        try {
          const reply = await accessResult(
            resolveCliDataDirectory(),
            options.credentialFile,
            options.request,
          );
          this.processResponse(json(reply));
        } catch (e) {
          this.processResponse(protocolFailure(e) ?? Response.error(e));
        }
      });
  }
}
