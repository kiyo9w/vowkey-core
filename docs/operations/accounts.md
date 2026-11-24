# Account sign-in

A password or login passkey authenticates the same account. Apple and an office identity provider are additional sign-in methods; they do not give the server a vault decryption key.

## Login passkeys

Set the server's `DOMAIN` to the HTTPS origin people use. A login passkey belongs to that relying-party hostname, so changing the domain does not move existing credentials to another hostname.

The web vault registers a discoverable credential with user verification. A credential with WebAuthn PRF can also wrap the private key that unlocks the account's user key. Without PRF, the passkey signs in and the person supplies the master password to unlock the vault. Registration and removal require account verification, and assertion challenges are single-use.

Run the browser-backed protocol check from `vowkey-core`:

```bash
scripts/check.sh e2e-passkey
```

It creates an isolated account and uses Chromium's virtual authenticator to register, sign in, sync, reject a replay, remove the credential and reject another sign-in with it. This is the non-PRF password-unlock path; it is not a hardware-passkey or PRF-unlock certification.

## Apple

Provision the app's Sign in with Apple capability and a Services ID with the production domain and return URL. The browser return URL is `<DOMAIN>/identity/connect/oidc-signin`; Apple returns the authorization response by form POST.

Configure the server together:

| Setting | Value |
| --- | --- |
| `APPLE_CLIENT_ID` | Apple Services ID for the browser flow |
| `APPLE_NATIVE_CLIENT_ID` | Native iPhone bundle ID accepted as an audience |
| `APPLE_TEAM_ID` | Apple developer team ID |
| `APPLE_KEY_ID` | Signing key ID |
| `APPLE_PRIVATE_KEY` | ES256 private key in PEM form, supplied outside Git |

The server signs a five-minute client-secret JWT for each Apple code exchange. Apple discovery does not advertise a UserInfo endpoint: the identity comes from the verified ID token, not an invented endpoint. The Vowkey client-to-server authorization-code redemption still checks its PKCE verifier; Apple's upstream exchange uses the documented confidential-client parameters.

Register the account-mail sending domain with Apple's private email relay. Keep a private-relay address as the account's key-derivation address until the person uses the normal change-email flow, which rewraps the key. An existing password account is not silently linked to an Apple identity because its email matches.

Before enabling the public path, use the real Apple identifiers and key to check browser sign-in, native iPhone sign-in, cancellation, a private-relay address and account mail to that address. The final iPhone provider presentation is an owner choice in [release decisions](release-decisions.md).

Apple references: [discovery](https://appleid.apple.com/.well-known/openid-configuration), [token validation](https://developer.apple.com/documentation/signinwithapplerestapi/generate-and-validate-tokens), and [environment setup](https://developer.apple.com/documentation/signinwithapple/configuring-your-environment-for-sign-in-with-apple).

## Offices

Use the organization-scoped identity, directory and trusted-device setup in [Keycloak](keycloak.md). Office sign-in authenticates the person; an approved device still needs its wrapped vault key before it can decrypt anything.
