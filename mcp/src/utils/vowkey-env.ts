/**
 * Filtered child environment for every `vowkey` subprocess we spawn.
 *
 * `vowkey` needs HOME/APPDATA/etc. to locate its data directory; without
 * them it would read/write the wrong files or fail. It does NOT need
 * the API client credentials (`VOWKEY_CLIENT_ID` / `VOWKEY_CLIENT_SECRET`) or
 * any other host environment variable the operator may have set on
 * the MCP server process. Passing the full `process.env` through to
 * `vowkey` widens the local exposure surface (e.g. another user on the
 * same host reading `/proc/<pid>/environ`) for no benefit.
 *
 * The `unlock` flow uses this with a one-shot password env var; every
 * other CLI command uses it with `VOWKEY_SESSION` inherited from
 * `process.env` when present.
 */
export function buildBwChildEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const passthrough = [
    // Filesystem / data dir
    'PATH',
    'HOME',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'VOWKEYCLI_APPDATA_DIR',
    // Windows essentials. `vowkey` is a Node.js process (we invoke it via the
    // Node runtime / its npm shim on Windows — see vowkey-cli.ts), and Node on
    // Windows needs SystemRoot to initialize crypto, DNS, and other Win32
    // subsystems. Without it the child fails to start or behaves
    // erratically. Both casings are passed through because callers and
    // libraries differ on which they set/read.
    'SystemRoot',
    'SYSTEMROOT',
    // Corporate-network plumbing: `vowkey` is a Node.js process and honors
    // these for proxy and additional-CA support. Without them the CLI
    // fails behind common enterprise setups (HTTP_PROXY-style egress,
    // self-signed roots from ZScaler / Burp Suite / corporate MITM).
    // Both casings are passed through because Node and downstream
    // libraries differ on which they read.
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
    'http_proxy',
    'https_proxy',
    'no_proxy',
    'NODE_EXTRA_CA_CERTS',
  ] as const;
  for (const key of passthrough) {
    const v = process.env[key];
    if (v !== undefined) env[key] = v;
  }
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined) env[k] = v;
    }
  }
  return env;
}
