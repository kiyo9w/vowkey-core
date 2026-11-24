# Transactional mail

Account mail sends from `mail.<domain>` through Resend. Postmark is the configured fallback. Receipts come from the seller. Product news uses a separate subdomain and list, never this stream.

`<domain>` is the product domain. The server default is `vowkey.com`, so the sending host is `mail.vowkey.com` until that setting changes. Every host below is configuration.

Checked against Resend's domain docs on 2026-11-04 ([add a domain](https://resend.com/docs/add-a-domain), [DMARC](https://resend.com/docs/dashboard/domains/dmarc)) and Apple's private relay docs ([configure](https://developer.apple.com/help/account/capabilities/configure-private-email-relay-service), [send](https://developer.apple.com/documentation/signinwithapple/communicating-using-the-private-email-relay-service)).

## DNS

Add `mail.<domain>` in the Resend dashboard (Domains, Add Domain), pick the region closest to the people who receive the mail, and leave the return path at Resend's default unless a custom return path is required. Resend then shows the records for that domain. Copy them. They are the DKIM and SPF values Resend generated for this domain (TXT, and MX or CNAME). They are not a fixed set of three CNAMEs, and a record published from memory will not verify.

Do not proxy a CNAME Resend shows (Cloudflare's orange cloud stops verification). Check the published records with [dns.email](https://dns.email/). Verification is often done within 15 minutes and can take 72 hours. After that, use Restart verification in the dashboard.

DMARC is separate, on the organizational domain, after Resend reports the domain verified. Start with reporting. `rua` is an address the owner reads. It may be on another domain.

| Name | Type | Value |
| --- | --- | --- |
| `_dmarc.<domain>` | TXT | `v=DMARC1; p=none; rua=mailto:<address-the-owner-reads>` |

Send every template to the seed list below and read the aggregate reports. When those reports show the legitimate mail passing, change the same record to quarantine:

`v=DMARC1; p=quarantine; rua=mailto:<address-the-owner-reads>`

Reject comes after quarantine has stayed clean. Do not publish either policy on the first day.

## Apple private relay

Register the sending domain before any Sign in with Apple account can receive mail. In Certificates, Identifiers & Profiles, open Services, then Configure under Sign in with Apple for Email Communication. Add `mail.<domain>` as an email source. The account holder or an admin does this. Apple checks SPF on the registered domain.

Resend signs with its own DKIM domain and uses its own envelope sender, so DKIM alignment is the path that satisfies the relay: the domain in the From address (`mail.<domain>`) is the domain registered with Apple, and that message is DKIM signed. Registering only the address `accounts@mail.<domain>` also works, but then every other From address needs its own registration. A relay address ends in `@privaterelay.appleid.com`, `@private.icloud.com`, or `@icloud.com`. Unregistered sources bounce.

## Server settings

| Name | Value |
| --- | --- |
| `EMAIL_PROVIDER` | `resend` (or `postmark`) |
| `EMAIL_API_KEY` | Resend API key, sent as `Authorization: Bearer`. For Postmark, the server token, sent as `X-Postmark-Server-Token`. |
| `EMAIL_API_URL` | Empty. Set only to override `https://api.resend.com/emails` or `https://api.postmarkapp.com/email`. |
| `SMTP_FROM` | `accounts@mail.<domain>` |
| `SMTP_FROM_NAME` | `Vowkey` |
| `SMTP_TIMEOUT` | Seconds before the HTTP call gives up. Default 15. |
| `DOMAIN` | Public origin used in links, such as `https://vault.vowkey.com`. |

`SMTP_HOST` and `USE_SENDMAIL` stay for servers that keep `EMAIL_PROVIDER=smtp`. Leave embedded images on so the logo travels with the message. The HTTP error names the provider and the status or timeout. It does not include the provider body or the recipient.

## Seed list

Before launch, send every account template to a mailbox the owner can open at each of these:

- Gmail
- Outlook
- Yahoo
- iCloud
- docomo
- au
- SoftBank
- a Vietnamese mailbox

In Resend, open the email log and confirm each send was delivered. A message that lands in junk fails the seed even when the log says delivered.

## What the owner creates

A Resend account, the verified `mail.<domain>` domain, the API key in `EMAIL_API_KEY`, the DMARC mailbox, and the Apple email-source registration. The server does not create any of these.
