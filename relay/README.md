# Vowkey relay

The apps ask a Decision model which detail each printed piece of a document is, and which saved detail each field of a form asks for. They do not hold the model's key. They send the request, in the wire format of Jev's `POST /v1/systemone`, to the relay with the access token of the person's account. The relay checks the token, counts the request against the account's allowance, and forwards it to the Decision endpoint with its own key. The answer goes back as it came.

- **One address, any model.** `RELAY_UPSTREAM_URL` is the endpoint of Jev, or of any model that answers in the same format. The relay sets the model itself and forwards only `state` and `questions`.
- **Tokens.** The sync server signs login tokens with RS256 and tells token kinds apart by issuer. The relay accepts a token only if the signature checks against the server's public key and the issuer is the server's login issuer, so an invitation or a file-download token is refused.
- **Allowance.** Each account gets `RELAY_LIMIT_PER_MINUTE` and `RELAY_LIMIT_PER_DAY` requests, counted in memory.
- **No record.** There is no database, and nothing about a request or an account is written to a log. `GET /healthz` gives counts and nothing else.
- **Not the vault.** The relay is its own service. It never sees the vault, and `vowkey-server` never sees what the relay reads.

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
| `RELAY_LIMIT_PER_MINUTE`, `RELAY_LIMIT_PER_DAY` | requests an account may send | `30`, `400` |
| `RELAY_MAX_BODY_BYTES`, `RELAY_TIMEOUT_MS` | largest request, longest wait for the model | `1000000`, `120000` |

Node 20 or later, no packages to install. `npm test` runs the unit tests; `scripts/e2e-relay.sh` signs in to a real `vowkey-server` and sends requests through the relay with the token it gives.

## What it does not do yet

- It is not deployed, and the apps do not call it: they still send the key from the keychain or `VOWKEY_DECISION_KEY` straight to the model. Calling the relay means sending the account's access token in its place, which the desktop app's main process does not have yet.
- Allowances live in the process, so a restart resets them and two instances do not share them.
- It answers no cross-origin requests, which the web app will need.
- It has one allowance for every account. A paid account with a larger one needs a source that says who has paid.
