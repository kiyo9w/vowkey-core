# Monitoring

Better Stack checks the public hosts from outside the VM, and receives a heartbeat after the backup. A missed heartbeat is a failed backup. A failed check is a host that stopped answering.

Public page counts use the anonymous `POST /api/counts` endpoint. Site and app senders omit credentials; that route alone accepts cross-origin requests without cookies. The vault's authenticated APIs keep their existing origin restrictions. Counts are stored as allowlisted daily totals, not request bodies or visitor records.

## Heartbeat

Create one heartbeat in Better Stack and put its URL in `BETTERSTACK_HEARTBEAT_URL` in the env file outside the repository. The URL is a secret.

`docs/operations/hosting/backup-cron.sh` requests it only after the encrypted archive has been uploaded. Schedule the cron daily and set the heartbeat period to 26 hours, so one missed night raises an alert and a slow upload does not.

The daily count job (`COUNTS_SCHEDULE`, `0 40 0 * * *`) logs `Daily counts completed for YYYY-MM-DD` only after its transaction succeeds. This also works on a quiet day with zero events. It makes no outbound monitoring request.

Create a separate 26-hour Better Stack heartbeat and put its URL in `COUNTS_HEARTBEAT_URL`. Schedule this check at 01:00 UTC each day:

```bash
VOWKEY_ENV_FILE=/etc/vowkey/business-services.env \
  /opt/vowkey/docs/operations/hosting/counts-heartbeat.sh
```

The wrapper requires yesterday's completion marker in the current server's last 26 hours of logs before sending the heartbeat. A failed job, stopped schedule, unavailable container, or missing logs fails the check without reporting success. Keep Docker logs for at least 26 hours.

## Status page

Create one status page. Each monitor runs from Better Stack, not from the VM.

| Check | URL | Passes when |
| --- | --- | --- |
| Vault | `https://<VOWKEY_DOMAIN>/alive` | HTTP 200 |
| Decision relay | `https://<VOWKEY_DOMAIN>/healthz` | HTTP 200, body contains `ok` |
| Push | `https://<PUSH_RELAY_DOMAIN>/healthz` | HTTP 200, body contains `ok` |
| Site | the public site origin | HTTP 200 |
| Crash store | `https://<BUGSINK_DOMAIN>/` | HTTP 200 |

## What the owner creates

The Better Stack account, the heartbeat, and the status page. Nothing here is created by the repository.

## Better Stack setup runbook

Owner actions in the Better Stack console; the repository only supplies the URLs and schedules below.

1. Create one Better Stack account and one team. Status pages and uptime monitors live there; heartbeats live under Monitors → Heartbeats.
2. Create the backup heartbeat: period **26 hours**, timeout 5 minutes, and put its URL in `BETTERSTACK_HEARTBEAT_URL` in the env file. `backup-cron.sh` calls it only after a successful encrypted upload, so a missed call means a failed backup.
3. Create the counts heartbeat the same way (26 hours) and put its URL in `COUNTS_HEARTBEAT_URL`. `counts-heartbeat.sh` calls it only after yesterday's completion marker appears in the server logs.
4. Create the status page (public, on its own subdomain) and add the five monitors from the table above, each with a 60-second interval and 3 retries before alerting. Monitors run from Better Stack's locations, not from the VM.
5. Route alerts to the owner: email plus the status page. Add a second notification channel (SMS or a chat webhook) once the launch date is set.
