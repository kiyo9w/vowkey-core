# Office sign-in with Keycloak

Keycloak sits in front of the office directory. Vowkey's server remains the relying party and never receives vault keys. One realm is one office.

## Development

`KEYCLOAK_PORT=8088 docker-compose -f docs/operations/keycloak-compose.yml up` starts Keycloak 26.8.1 with two synthetic realms, imported from `docs/operations/keycloak/`:

- `workforce` — the office directory. It is a real SAML 2.0 identity provider (its IdP metadata is at `/realms/workforce/protocol/saml/descriptor`) with the test users `staff` / `staff` (`staff@office.example`) and `colleague` / `colleague` (`colleague@office.example`).
- `office` — one office. It brokers sign-in to `workforce` over SAML (`kc_idp_hint=workforce` sends the browser straight there), creates the user on first login from the signed assertion, and serves Vowkey over OIDC as the confidential client `vowkey`.

The development admin is `admin`; its password is `admin` and is only for this local file. Realm files use `${KEYCLOAK_URL}`, which the compose file sets to the published URL, so any `KEYCLOAK_PORT` works. The `vowkey` client secret is `development-only` for this local realm only; read the real secret from the Keycloak admin console and never put it in the repository.

Point the server's enterprise authority at `http://localhost:8088/realms/office`:

```
SSO_ENABLED=true
SSO_AUTHORITY=http://localhost:8088/realms/office
SSO_CLIENT_ID=vowkey
SSO_CLIENT_SECRET=development-only
SSO_SCOPES="openid email profile"
# development only: the office realm has a single identity provider
SSO_AUTHORIZE_EXTRA_PARAMS="kc_idp_hint=workforce"
```

The `vowkey` client's redirect URI must be the server's callback, `<domain>/identity/connect/oidc-signin`; set it in the admin console (the harness does this through the admin REST API).

## End-to-end check

`scripts/e2e-office.sh` runs the whole office journey locally: it starts this compose file and a fresh server, then drives a real SAML sign-in of `staff` through the `workforce` realm into the `office` realm and on to Vowkey over OIDC, provisions users and a group over SCIM with the organization API key, registers a device key, approves a new device from another device and as an organization admin, and decrypts a vault item with the user key recovered from the approved request. It also asserts the denials: no bearer, a foreign organization's key, and non-Office organizations on SCIM, SSO and admin approval. See the header of `scripts/e2e-office.mjs`.

## Connecting a directory

In the office realm, create an identity provider:

- Entra ID: OIDC, issuer `https://login.microsoftonline.com/<tenant>/v2.0`.
- Google Workspace: OIDC, issuer `https://accounts.google.com`.
- Okta: OIDC or SAML. For SAML, the assertion consumer is `/realms/office/broker/<alias>/endpoint`.

Map the directory email to the `email` claim and require it to be verified (`trustEmail` for a SAML provider, `email_verified` for OIDC). The account email is the vault key-derivation salt, so a later email change uses the existing change-email flow. Vowkey never asks the directory for the master password: a new device is approved by another of the person's devices or by an organization admin, and the server only ever stores the user key wrapped to the approving device's public key.

## Directory sync

Keycloak's own SCIM endpoint only changes users inside the realm. It does not call Vowkey, so enabling it is not directory sync.

Connect the directory to Vowkey directly:

- Entra ID: an Enterprise Application with provisioning pointed at `https://<domain>/api/organizations/<organization-id>/scim/v2`.
- Okta: an application integration whose SCIM base URL is that same path.

The bearer is the organization API key, issued by the organization owner (`POST /api/organizations/<id>/api-key`): either the key itself (`<org-uuid>.<secret>`) or the access token from `POST /identity/connect/token` with `grant_type=client_credentials`, `client_id=organization.<org-id>` and that key as `client_secret`. The Office plan is required; a non-Office organization gets 403 and an unknown key gets 401. Users and groups are created, updated and removed one record at a time (`POST`/`PUT`/`PATCH`/`DELETE` on `/Users` and `/Groups`); a user update does not remove anyone else. `PATCH` supports `active`, `userName`, `externalId`, `emails` and group `members`; the account email itself never changes through SCIM. Deactivating a user (`active: false`) revokes the membership, reactivating restores it, and `DELETE` removes it; the organization owner is never removed.

There is no supported bridge that receives Keycloak's inbound SCIM and pushes it to Vowkey. Do not describe the local realm as an end-to-end directory sync.

## Entitlements

Single sign-on, directory sync and admin device approval belong to the Office plan: the SSO policy endpoints, the SCIM routes and `POST /api/organizations/<id>/auth-requests/<id>` all check the organization's plan and refuse anything else.
