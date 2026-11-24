# Production on AWS Tokyo

One EC2 instance runs the account server and the Decision relay. Caddy in front of them gets its own HTTPS certificates.

| Part | Where |
| --- | --- |
| Instance | `vowkey-prod-tokyo`, `t4g.large`, Ubuntu, region `ap-northeast-1`, AWS account `018157124058` |
| Address | Elastic IP `52.198.109.222`; security group allows 22, 80, 443 (tcp) and 443 (udp) |
| Login | `ssh -i ~/.ssh/vowkey_aws_ed25519 ubuntu@52.198.109.222` |
| Account server | systemd `vowkey-server`, binds `127.0.0.1:8000`, `DOMAIN=https://vault.vowkey.app`, data in `/var/lib/vowkey/data`, SSO drop-in `/etc/vowkey/server-sso.env` |
| Identity broker (Google & GitHub) | Docker `vowkey-dex` (`ghcr.io/dexidp/dex:v2.41.1`), `127.0.0.1:5556`, issuer `https://auth.vowkey.app`, config `/etc/dex/config.yaml`, SQLite `/var/lib/dex/dex.db` |
| Decision relay | systemd `vowkey-relay`, `127.0.0.1:8787` |
| Web server | systemd `caddy`, `/etc/caddy/Caddyfile`; on-demand HTTPS for the `vowkey.app` hostnames it lists |

## Names

The apps use one address, `https://vault.vowkey.app`: the server serves `/api`, `/identity`, `/icons`, `/notifications` and the web vault on that host. DNS-only A records (no Cloudflare proxy) point `vault`, `api`, `icons`, `notifications`, `events`, `scim` and `send` at the Elastic IP, so Caddy answers the certificate challenges itself. `vowkey.app`, `www`, `decision` and `identity` are Cloudflare Workers routes and stay as they are.

## Credentials & DNS

- **Keychain secrets** (`ngotrung`): `aws.vowkey.member` (AWS profile `018157124058_Member`; SSO session keys expire within hours) and `cloudflare.vowkey.dns` (Zone DNS Edit token for `vowkey.app`, Cloudflare Zone ID `2c9d95873eb1b71eca22f70dc870b761`). Wrangler's default login cannot edit DNS records.
- `docs/operations/hosting.md` (Hetzner) is historical — this AWS Tokyo instance is live production.

## Check it

```bash
curl https://vault.vowkey.app/alive
curl https://vault.vowkey.app/api/config
```

## Update the server

The server is built on the instance from `/opt/vowkey/server` (`cargo build --release --bin vowkey-server --features sqlite,vendored_openssl`), then `sudo systemctl restart vowkey-server`. Back up `/var/lib/vowkey/data` first.
