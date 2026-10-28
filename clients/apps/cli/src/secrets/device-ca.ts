import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as tls from "tls";

import {
  BasicConstraintsExtension,
  cryptoProvider,
  ExtendedKeyUsage,
  ExtendedKeyUsageExtension,
  KeyUsageFlags,
  KeyUsagesExtension,
  SubjectAlternativeNameExtension,
  X509Certificate,
  X509CertificateGenerator,
} from "@peculiar/x509";

import { SecretsError } from "./errors";

const ALGORITHM = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" } as const;
const subtle = crypto.webcrypto.subtle;

cryptoProvider.set(crypto.webcrypto as unknown as Crypto);

function toPem(label: string, der: ArrayBuffer): string {
  const lines =
    Buffer.from(der)
      .toString("base64")
      .match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

function fromPem(pem: string): Buffer {
  const body = pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  return Buffer.from(body, "base64");
}

function isIpAddress(host: string): boolean {
  return /^[0-9.]+$/.test(host) || host.includes(":");
}

/**
 * The device's certificate authority for the key proxy. It is an ECDSA P-256 CA that can sign for
 * any DNS name; the proxy, not the certificate, limits it to the hosts a key lists. The private key
 * stays in a file only its owner can read.
 */
export class DeviceCa {
  private readonly contexts = new Map<string, tls.SecureContext>();

  private constructor(
    readonly certificatePem: string,
    private readonly certificate: X509Certificate,
    private readonly privateKey: CryptoKey,
  ) {}

  /** Loads the CA stored in `directory`, creating it on first use. */
  static async loadOrCreate(directory: string): Promise<DeviceCa> {
    const certFile = path.join(directory, "proxy-ca.crt");
    const keyFile = path.join(directory, "proxy-ca.key");
    if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
      try {
        const certificatePem = fs.readFileSync(certFile, "utf8");
        const privateKey = await subtle.importKey(
          "pkcs8",
          fromPem(fs.readFileSync(keyFile, "utf8")),
          ALGORITHM,
          false,
          ["sign"],
        );
        const certificate = new X509Certificate(certificatePem);
        if (certificate.notAfter.getTime() > Date.now() + 24 * 3600 * 1000) {
          return new DeviceCa(certificatePem, certificate, privateKey);
        }
      } catch {
        // An unreadable CA is replaced below.
      }
    }
    return await DeviceCa.create(directory, certFile, keyFile);
  }

  /** A CA that exists only in memory, for a test origin. */
  static async ephemeral(commonName: string): Promise<DeviceCa> {
    return await DeviceCa.create(null, "", "", commonName);
  }

  private static async create(
    directory: string | null,
    certFile: string,
    keyFile: string,
    commonName = "Vowkey developer proxy",
  ): Promise<DeviceCa> {
    const keys = await subtle.generateKey(ALGORITHM, true, ["sign", "verify"]);
    const notBefore = new Date(Date.now() - 5 * 60 * 1000);
    const certificate = await X509CertificateGenerator.createSelfSigned({
      serialNumber: crypto.randomBytes(16).toString("hex"),
      name: `CN=${commonName}`,
      notBefore,
      notAfter: new Date(Date.now() + 2 * 365 * 24 * 3600 * 1000),
      signingAlgorithm: ALGORITHM,
      keys,
      extensions: [
        new BasicConstraintsExtension(true, 0, true),
        new KeyUsagesExtension(KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign, true),
      ],
    });
    const certificatePem = certificate.toString("pem").trimEnd() + "\n";
    if (directory != null) {
      const pkcs8 = await subtle.exportKey("pkcs8", keys.privateKey);
      try {
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
        // The key is created with its protection already applied, then written.
        const fd = fs.openSync(keyFile, "w", 0o600);
        try {
          fs.writeFileSync(fd, toPem("PRIVATE KEY", pkcs8));
        } finally {
          fs.closeSync(fd);
        }
        fs.writeFileSync(certFile, certificatePem, { mode: 0o600 });
      } catch (e) {
        throw new SecretsError(
          "write-failed",
          `Could not store the proxy certificate: ${(e as Error).message}`,
        );
      }
    }
    return new DeviceCa(certificatePem, certificate, keys.privateKey);
  }

  /** A TLS context that presents a certificate for `host`, signed by this CA. */
  async contextFor(host: string): Promise<tls.SecureContext> {
    const key = host.toLowerCase();
    const cached = this.contexts.get(key);
    if (cached != null) {
      return cached;
    }
    const leafKeys = await subtle.generateKey(ALGORITHM, true, ["sign", "verify"]);
    const leaf = await X509CertificateGenerator.create({
      serialNumber: crypto.randomBytes(16).toString("hex"),
      subject: `CN=${key}`,
      issuer: this.certificate.subject,
      notBefore: new Date(Date.now() - 5 * 60 * 1000),
      notAfter: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      signingAlgorithm: ALGORITHM,
      publicKey: leafKeys.publicKey,
      signingKey: this.privateKey,
      extensions: [
        new BasicConstraintsExtension(false, undefined, true),
        new KeyUsagesExtension(KeyUsageFlags.digitalSignature, true),
        new ExtendedKeyUsageExtension([ExtendedKeyUsage.serverAuth], false),
        new SubjectAlternativeNameExtension(
          [{ type: isIpAddress(key) ? "ip" : "dns", value: key }],
          false,
        ),
      ],
    });
    const context = tls.createSecureContext({
      key: toPem("PRIVATE KEY", await subtle.exportKey("pkcs8", leafKeys.privateKey)),
      cert: leaf.toString("pem").trimEnd() + "\n" + this.certificatePem,
    });
    this.contexts.set(key, context);
    return context;
  }
}
