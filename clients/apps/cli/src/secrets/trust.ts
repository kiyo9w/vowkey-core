import { execFileSync } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { SecretsError } from "./errors";

export type CommandRunner = (command: string, args: string[]) => void;

const defaultRunner: CommandRunner = (command, args) => {
  execFileSync(command, args, { stdio: "inherit" });
};

function sha1Fingerprint(pem: string): string {
  const der = Buffer.from(pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, ""), "base64");
  return crypto.createHash("sha1").update(der).digest("hex").toUpperCase();
}

/**
 * Adds the device CA to, or removes it from, the user's trust store. This is the one place
 * Vowkey changes system trust, and only when the person runs `vowkey proxy trust`. The trust it
 * adds covers every host, not just a key's, and outlasts the proxy until `--remove`.
 */
export function trustDeviceCa(
  certificateFile: string,
  remove: boolean,
  platform: NodeJS.Platform = process.platform,
  run: CommandRunner = defaultRunner,
): string {
  const pem = fs.readFileSync(certificateFile, "utf8");
  try {
    if (platform === "darwin") {
      const keychain = path.join(os.homedir(), "Library/Keychains/login.keychain-db");
      if (remove) {
        run("security", ["remove-trusted-cert", certificateFile]);
        run("security", ["delete-certificate", "-Z", sha1Fingerprint(pem), keychain]);
        return "Removed the proxy certificate from your login keychain.";
      }
      run("security", ["add-trusted-cert", "-r", "trustRoot", "-k", keychain, certificateFile]);
      return "Added the proxy certificate to your login keychain. Every app you run now trusts it.";
    }
    if (platform === "win32") {
      if (remove) {
        run("certutil", ["-user", "-delstore", "Root", sha1Fingerprint(pem)]);
        return "Removed the proxy certificate from your user Root store.";
      }
      run("certutil", ["-user", "-addstore", "Root", certificateFile]);
      return "Added the proxy certificate to your user Root store. Every app you run now trusts it.";
    }
  } catch (e) {
    throw new SecretsError("write-failed", `Could not change trust: ${(e as Error).message}`);
  }
  throw new SecretsError(
    "unavailable",
    `Trust for this system is set by your distribution. The certificate is ${certificateFile}.`,
  );
}
