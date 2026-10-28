import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as tls from "tls";

const SYSTEM_BUNDLES = [
  "/etc/ssl/cert.pem",
  "/etc/ssl/certs/ca-certificates.crt",
  "/etc/pki/tls/certs/ca-bundle.crt",
];

/**
 * A child-only file holding the roots the child already trusts plus the device CA. If the parent
 * already set SSL_CERT_FILE, that file is the base; otherwise the system bundle, or the roots
 * Node itself ships. The device CA is never the only root in it. Nothing here touches the login
 * keychain or the Windows user store.
 */
export function writeChildBundle(
  directory: string,
  deviceCaPem: string,
  existingBundlePath: string | undefined,
): { file: string; remove: () => void } {
  let base: string | null = null;
  for (const candidate of [existingBundlePath, ...SYSTEM_BUNDLES]) {
    if (candidate != null && candidate !== "") {
      try {
        base = fs.readFileSync(candidate, "utf8");
        break;
      } catch {
        // Try the next place a bundle can live.
      }
    }
  }
  base ??= tls.rootCertificates.join("\n");

  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(
    directory,
    `bundle-${process.pid}-${crypto.randomBytes(4).toString("hex")}.pem`,
  );
  fs.writeFileSync(file, base.trimEnd() + "\n" + deviceCaPem.trimEnd() + "\n", { mode: 0o600 });
  return {
    file,
    remove: () => {
      try {
        fs.unlinkSync(file);
      } catch {
        // Already removed.
      }
    },
  };
}
