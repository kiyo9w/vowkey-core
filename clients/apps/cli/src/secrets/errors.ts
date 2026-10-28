/** The codes a developer-secrets failure can carry. They never include a key value. */
export type SecretsErrorCode =
  | "locked"
  | "unavailable"
  | "missing-ref"
  | "refused"
  | "write-failed"
  | "not-listening"
  | "host-ambiguous"
  | "host-mismatch"
  | "tls-untrusted"
  | "body-not-scanned";

export class SecretsError extends Error {
  constructor(
    readonly code: SecretsErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SecretsError";
  }
}
