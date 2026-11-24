# Vowkey relay

The apps ask a Decision model which detail each printed piece of a document is, and which saved detail each field of a form asks for. They do not hold the model's key. They send the request, in the wire format of Jev's `POST /v1/systemone`, to the relay with the access token of the person's account. The relay checks the token, counts the request against the account's allowance, and forwards it to the Decision endpoint with its own key. The answer goes back as it came.

- **One address, any model.** `RELAY_UPSTREAM_URL` is the endpoint of Jev, or of any model that answers in the same format. The relay sets the model itself and forwards only `state` and `questions`.
- **Tokens.** The sync server signs login tokens with RS256 and tells token kinds apart by issuer. The relay accepts a token only if the signature checks against the server's public key and the issuer is the server's login issuer, so an invitation or a file-download token is refused.
- **Allowance.** The server settles every account request through `/api/decision/consume` before it reaches the model. Its database owns the UTC daily base allowance, monthly Hosted Agent allowance and purchased request credits across restarts and relay replicas, spent in that order. The relay keeps only a per-minute burst guard. Guests keep their separate grant and consume route.
- **Usage.** With `RELAY_SERVICE_KEY` set, the relay reports only account, configured model, provider-reported token/cost totals, latency and outcome to `/api/decision/usage`. Missing provider totals are `null`, not invented measurements. The server stores daily totals by plan, not account ids or request bodies.
- **Not the vault.** The relay is its own service. It never sees the vault, and `vowkey-server` never sees what the relay reads.

## Hosted image and form reading

`readers.mjs` is shared by the Node relay and the Cloudflare Worker in `edge/`. Both serve:

- `POST /v1/documents/read-vision`: `{v:1,imageDataUrl,fileName?}` → `{kind,details,locators?}`. The configured vision model reads the original image and values. Dates are normalized when unambiguous. Locators use page-zero, top-left normalized `x,y,w,h`; unreliable geometry is omitted without discarding readable details.
- `POST /v1/forms/describe`: the collected form graph → `FormAsksV1`, preserving the real target, section and field identities.

The Worker serves `decision.vowkey.app` and the existing guest-grant route on `identity.vowkey.app`. It uses the Cloudflare secret `OPENAI_KEY`, `gpt-6-luna` for `/v1/systemone`, and `gpt-6.1-terra` for image/form reading. The provider key is never packaged with the apps.

The Worker retains public demo access; its guest grant does not implement the Node relay's signed-token or account-allowance checks described below. The Node relay and the public Worker are separate authorization paths.

Deploy the existing Worker with `npx wrangler deploy --config relay/edge/wrangler.toml --keep-vars` from the repository root. `npm test` in `relay/` covers both route adapters and the shared readers.

## Run it

```bash
openssl rsa -in "$DATA_FOLDER/rsa_key.pem" -pubout -out token-public.pem   # on the sync server, once
RELAY_TOKEN_PUBLIC_KEY=token-public.pem \
RELAY_TOKEN_ISSUER='https://vault.example.com|login' \
RELAY_UPSTREAM_KEY=… \
node serve.mjs
```

| Setting | Meaning | Default |
| --- | --- | --- |
| `RELAY_TOKEN_PUBLIC_KEY` | file with the sync server's public key | required |
| `RELAY_TOKEN_ISSUER` | the sync server's origin followed by `\|login` | required |
| `RELAY_UPSTREAM_KEY` | the Decision endpoint's key (not needed for a model on this computer) | required |
| `RELAY_UPSTREAM_URL` | the Decision endpoint | `https://api.typesafe.ai/v1/systemone` |
| `RELAY_UPSTREAM_MODEL` | the model the relay asks for | `jev-1.14.0` |
| `RELAY_HOST`, `RELAY_PORT` | where it listens | `127.0.0.1`, `8787` |
| `RELAY_ALLOW_HTTP` | allow HTTP endpoints on a private deployment network; production endpoints use HTTPS | `false` |
| `RELAY_LIMIT_PER_MINUTE` | per-account burst guard | `30` |
| `RELAY_ACCOUNT_CONSUME_URL` | account allowance endpoint | server origin + `/api/decision/consume` |
| `RELAY_USAGE_URL`, `RELAY_SERVICE_KEY` | content-free usage endpoint and its shared service key | server origin + `/api/decision/usage`; key unset |
| `RELAY_MAX_BODY_BYTES`, `RELAY_TIMEOUT_MS` | largest request, longest model wait | `10000000`, `120000` |

Node 20 or later, no packages to install. `npm test` runs the unit tests; `scripts/e2e-relay.sh` signs in to a real `vowkey-server` and sends requests through the relay with the token it gives.

## Organization allowance

An account caller may send `X-Vowkey-Organization` with the organization id. The relay forwards that scope to the server, which requires current confirmed membership and settles the organization's balance instead of the personal balance. A guest cannot select an organization.

The relay and the sync server need the same `RELAY_SERVICE_KEY` for usage reports. Set the server's `RELAY_USAGE_MODELS` to the configured upstream and form-reader model identifiers. No model response or printed text enters the counts table.
