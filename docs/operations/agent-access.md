# Agent access

## Official Bitwarden Agent Access

AAC v0.11.0 works through the official Bitwarden CLI against a local Vowkey server. The exercised path was official `bw` 2026.10.1 login, sync, encrypted item creation and retrieval, then `aac listen --provider bitwarden` through the official `ap-proxy` relay. A remote `aac connect --id ... --output json` returned the synthetic credential after the provider's one-time approval. No Vowkey protocol or server change was needed for this path.

AAC talks to `bw`, not directly to a Vowkey agent endpoint. Its approval prompt belongs to the AAC provider. This is separate from Vowkey's own local fill approval.

For a local replay, use a disposable account and isolated profiles:

1. Install the official AAC release and official Bitwarden CLI. Set `HOME`, `BITWARDENCLI_APPDATA_DIR` and the XDG directories to scratch paths for these processes.
2. Configure `bw` to the local Vowkey URL. Trust the local certificate through `NODE_EXTRA_CA_CERTS`; log in with a synthetic account using `--passwordenv`. Keep the returned `BW_SESSION` in the process environment, not logs or command arguments.
3. Create a synthetic login item through `bw`, sync, and confirm `bw get item` retrieves it.
4. Build the official `ap-proxy` from the same AAC release and run it with `BIND_ADDR=127.0.0.1:18080`.
5. Run `aac listen --provider bitwarden --proxy-url ws://127.0.0.1:18080`. Use its pairing code through `AAC_TOKEN` in the remote process environment.
6. Run `aac connect --proxy-url ws://127.0.0.1:18080 --id <synthetic-item-id> --output json`. Compare the peer fingerprints when prompted, name the connection, then approve the credential with `y`. This is one approval; `a` enables temporary auto-approval and is a different test.
7. Assert the returned credential in memory or a private scratch file. The JSON contains the secret. Stop the scratch processes and remove their isolated profiles when finished.

## Vowkey MCP and person approval

`mcp/dist/index.js` uses stdio transport only. It starts no HTTP, SSE or WebSocket listener. The MCP tools call the local CLI/broker; list and get results use `@vk:` references rather than saved values.

A detail marked **Ask first** remains pending until the person answers. **Always allow on this site** creates the existing scoped grant; **Don't fill** still wins over that grant. Metadata reads are not credential-use approvals.

Multi-batch requests and result polling use the executor's `pending` status. They remain pending while any batch waits for the person. The adapter regression exercises a mixed completed/pending batch and completed-only results; the executor checks cover person-only answers, single use and explicit ask/never policies.

Run from `clients/`:

```sh
env -u NODE_OPTIONS npx jest libs/common/src/vault/agent/executor.spec.ts --runInBand --ci --coverage=false --testNamePattern='lets the person answer once|does not approve an ask or a never rule'
```

Run `npm test -- --runInBand --testPathPatterns=zero-leak-agent` from `mcp/` for adapter coverage. `scripts/e2e-contracts.sh` adds the fresh-server cross-device approval and elected-executor contract.

Primary source: [Bitwarden Agent Access v0.11.0](https://github.com/bitwarden/agent-access/tree/v0.11.0).
