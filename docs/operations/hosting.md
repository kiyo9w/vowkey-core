# Hosting

One VM runs the server, the Decision relay, the push relay and Bugsink. Cloudflare sits in front. Configure the vault, push and crash-store hostnames separately; the public website can use a fourth origin.

The published `server/Dockerfile` copies a web vault from `docker.io/vowkey/web-vault`. That image is not published. `hosting/Dockerfile.server` builds the same server from this repository and copies the vault built from `clients/`.

## What the owner creates

A Hetzner Cloud VM, a Cloudflare zone for the service hostnames, an object-storage bucket at a provider other than Hetzner, an age keypair, a Better Stack heartbeat, and any mail provider account. None of these exist in the repository, and this file does not create them. The local run uses `*.localhost` names instead.

## Provision the Hetzner VM

Owner actions in the Hetzner Cloud console; nothing here is created by the repository.

1. Create a project and a Cloud server: `CX23` (2 vCPU, 4 GB RAM, 40 GB disk) in the region closest to the people who will use it, image `Ubuntu 24.04 LTS`, with a public IPv4 address. 4 GB is enough for the four containers here plus Caddy certificate storage; the Rust release build happens on the owner's Mac or a scratch VM, not on this one.
2. Add an SSH key for the owner and note the server's public IP.
3. Create a Cloudflare zone for the service hostnames from `env.template` (`VOWKEY_DOMAIN`, `PUSH_RELAY_DOMAIN`, `BUGSINK_DOMAIN`) and point A records at that IP, DNS-only at first (see "Cloudflare" below).
4. In Hetzner Cloud → Firewalls, attach one firewall to the server:

   | Type | Source | Port | Purpose |
   | --- | --- | --- | --- |
   | TCP | 0.0.0.0/0, ::/0 | 22 | SSH |
   | TCP | 0.0.0.0/0, ::/0 | 80 | ACME HTTP and Caddy HTTP |
   | TCP | 0.0.0.0/0, ::/0 | 443 | Caddy HTTPS |

   Everything else is closed; the containers talk to each other on the internal Compose network, not over public ports.
5. On first SSH login, install the host prerequisites from "Backup" below (Bash, Docker Compose plugin, `age`, `sqlite3`, Python 3.12+, AWS CLI) and create `/var/lib/vowkey` and `/opt/vowkey`:

   ```bash
   apt-get update && apt-get install -y docker.io docker-compose-plugin age sqlite3 python3 awscli
   mkdir -p /var/lib/vowkey /opt/vowkey
   git clone <this repository> /opt/vowkey
   ```

6. Copy the filled env file to `/var/lib/vowkey/hosting.env`, `chmod 600`, and run `docs/operations/hosting/bootstrap.sh` from `/opt/vowkey` with the exports from "Start" below.

Object storage for backups is a bucket at a provider other than Hetzner (the backup section names the settings); create it in that provider's console and put its credentials in the env file.


## Build the vault

From `vowkey-core`, with Node 24:

```bash
docs/operations/hosting/build-vault.sh
```

That runs `npm run build:oss:selfhost:prod --workspace @vowkey/web-vault` and stages the output at `docs/operations/hosting/build-vault/web-vault`, which is the Dockerfile input. Do not commit the staged directory.

Copy `docs/operations/hosting/env.template` to a path outside the repository and fill it. `VOWKEY_ENV_FILE` names that path and the file must be mode 600. Set `VOWKEY_DOMAIN=vault.example.com`, `PUSH_RELAY_DOMAIN=push.example.com` and `BUGSINK_DOMAIN=bugsink.example.com` there. `PUSH_RELAY_PUBLIC_ORIGIN=https://example.com` is the exact origin serving the public host-registration page, not the vault origin. `VOWKEY_TOKEN_PUBLIC_KEY` is a host path the bootstrap writes.

## Start

```bash
export VOWKEY_ENV_FILE=/var/lib/vowkey/hosting.env
export VOWKEY_DOMAIN=vault.example.com
export VOWKEY_TOKEN_PUBLIC_KEY=/var/lib/vowkey/token.pem
docs/operations/hosting/bootstrap.sh
```

Bootstrap is staged because the relay needs the server's public key and the server generates that key on first start:

1. Build the images using `compose.yml`; add `compose.local.yml` only when `VOWKEY_LOCAL=true`.
2. Start the server alone and wait for `/alive`.
3. Derive `VOWKEY_TOKEN_PUBLIC_KEY` inside the server container. Only the public key is copied out.
4. Start every service and wait for the proxy to answer.

The server volume holds `db.sqlite3`, `config.json`, `attachments/`, `sends/` and `rsa_key.pem`. The push volume holds `push.sqlite`. Bugsink holds its own database. A named volume is persistent; a container without one is not.

Caddy serves the vault and the Decision relay on `VOWKEY_DOMAIN` (`/v1/*` goes to the relay). Push uses `PUSH_RELAY_DOMAIN`, because `/connect/token` on the vault host is the server's own login. Bugsink uses `BUGSINK_DOMAIN`.

For a local run, put `VOWKEY_DOMAIN=vault.localhost`, `PUSH_RELAY_DOMAIN=push.vault.localhost` and `BUGSINK_DOMAIN=bugsink.vault.localhost` in the env file. Export `VOWKEY_LOCAL=true` and optionally `VOWKEY_LOCAL_PORT=8102`, then run the same bootstrap. The override replaces public port bindings with one loopback-only HTTP port and uses `Caddyfile.local`. Localhost is a browser secure context; no public domain, certificate or DNS challenge is needed. All three hosts use that port. Set `PUSH_RELAY_PUBLIC_ORIGIN` to the local public-site origin when exercising registration across origins.

`VOWKEY_ENV_FILE` is supplied explicitly to Compose. Use shell-compatible assignments in this owner-controlled file because the backup job exports the same settings; quote values containing spaces, including `COUNTS_SCHEDULE`.

## Cloudflare

Point the three configured service hostnames at the VM. During the first bootstrap, leave these records DNS-only and allow ports 80 and 443 so Caddy can obtain public certificates through ACME. After all three HTTPS hosts work, enable Cloudflare proxying with Full (strict). Caddy renews its certificates automatically. Authenticated Origin Pulls are not configured by this stack.

Do not proxy the mail records from `mail.md`.

Push by default: the server's `PUSH_ENABLED` is false until the owner creates an installation. To enable it, bring the push relay up, use the public host page with its relay URL set to `https://push.example.com`, and put the returned id and key in `PUSH_INSTALLATION_ID` / `PUSH_INSTALLATION_KEY` in the env file. Keep `PUSH_ENABLED=false` until both are set. APNs and FCM credentials are owner accounts; until their files exist, their sends are skipped and registration still works.

## Backup

The backup is one age-encrypted tar containing the server database, attachments, sends, `config.json`, RSA private key and push database. The nightly job briefly stops the server and push relay while copying their data, then restarts them before encryption and upload. That write pause keeps attachment bytes and database references consistent. `backup.sh` can also run against stopped services or such a quiescent copy; it uses SQLite's backup operation and checks both databases before encryption. Icon cache and temporary uploads are left out.

Generate the key on a machine that is not the VM, and copy only the recipient to the VM:

```bash
age-keygen -o backup.age
age-keygen -y backup.age > backup.age.pub
```

`BACKUP_AGE_RECIPIENT` points at the public file. The identity stays with the owner.

On the VM, nightly:

```cron
15 2 * * * VOWKEY_ENV_FILE=/var/lib/vowkey/hosting.env /opt/vowkey/docs/operations/hosting/backup-cron.sh
```

`backup-cron.sh` reads the trusted env file, stops both writers, copies their data through Compose, and restarts them even if a copy fails. It calls `backup.sh`, uploads the encrypted archive with `aws s3 cp`, then requests `BETTERSTACK_HEARTBEAT_URL`. A failed copy, database check, encryption or upload leaves the heartbeat unsent.

Host prerequisites are Bash, Docker Compose, `age`, `sqlite3`, Python 3.12 or later, and the AWS CLI for uploads. `hosting/Dockerfile.backup` supplies archive and restore tools in a container; the cron orchestrator runs on the Docker host.

## Restore drill

Download one archive into an empty directory. Restore decrypts into a temporary directory, validates allowed regular-file paths, checks both databases and parses the RSA key before publishing the scratch files. It accepts an absent or empty data directory and a new push database path.

```bash
aws s3 cp "s3://${BACKUP_S3_BUCKET}/vowkey-STAMP.tar.age" ./vowkey.tar.age --endpoint-url "$BACKUP_S3_ENDPOINT"
./docs/operations/hosting/restore.sh ./vowkey.tar.age /tmp/vowkey-scratch/data /tmp/vowkey-scratch/push.sqlite /path/to/backup.age
```

Start a second server against that directory and open it. The account that existed at backup time signs in, and its attachments download. Stop the scratch server and delete the directory when the drill is done. Do not point the scratch server at the live volume.

A local check without S3 uses the same two scripts against a data directory and a push file, then starts `vowkey-server` with `DATA_FOLDER` set to the restored directory.
