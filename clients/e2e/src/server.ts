import { account } from "./credentials";

/** The account's server, which is also the web app's address. */
export const WEB_VAULT_URL = account().server;

/**
 * A server on this machine answers with a self-signed certificate. A deployed vault keeps TLS
 * verification on, since the suite sends real credentials to it.
 */
export const IS_LOCAL_SERVER = ["localhost", "127.0.0.1"].includes(new URL(WEB_VAULT_URL).hostname);
