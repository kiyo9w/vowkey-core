# Push

Vowkey's phone apps register with the server. The server asks this relay to deliver a sync notification. The notification names the change (`type` 0–29) and its ids. It never contains a vault item.

The relay is `push-relay/`. One process serves `/connect/token` and `/push/*` at `push.<domain>`, so `PUSH_IDENTITY_URI` and `PUSH_RELAY_URI` point to that same origin.

## Run it

```bash
PUSH_RELAY_DATABASE=/var/lib/vowkey/push.sqlite \
PUSH_RELAY_PUBLIC_ORIGIN=https://<domain> \
APNS_TEAM_ID=… APNS_KEY_ID=… APNS_KEY_FILE=/run/secrets/apns.p8 \
FCM_SERVICE_ACCOUNT_FILE=/run/secrets/fcm.json \
node push-relay/serve.mjs
```

| Setting | Meaning | Default |
| --- | --- | --- |
| `PUSH_RELAY_HOST`, `PUSH_RELAY_PORT` | where it listens | `127.0.0.1`, `8790` |
| `PUSH_RELAY_DATABASE` | SQLite file for installations and device tokens | `push-relay.sqlite` |
| `PUSH_RELAY_PUBLIC_ORIGIN` | site origin the host page belongs to | `https://vowkey.com` |
| `PUSH_TOKEN_TTL` | installation bearer lifetime, seconds | `3600` |
| `APNS_HOST` | `https://api.push.apple.com` or `https://api.sandbox.push.apple.com` | production |
| `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_KEY_FILE` | token authentication for APNs | unset, iOS sends are skipped |
| `APNS_TOPIC` | the iOS app the key may address | `com.vowkey.app` |
| `FCM_SERVICE_ACCOUNT_FILE` | Firebase service account JSON | unset, Android sends are skipped |

Node 24. No packages to install. A missing APNs key or FCM account skips that platform and still accepts the registration.

The server side, in its own environment:

```text
PUSH_ENABLED=true
PUSH_INSTALLATION_ID=<from /installations>
PUSH_INSTALLATION_KEY=<from /installations>
PUSH_IDENTITY_URI=https://push.<domain>
PUSH_RELAY_URI=https://push.<domain>
```

Both URIs must be HTTPS. Point both at this process.

## What the owner creates

### Apple

1. In the CLASSFUNC Apple Developer team `98VU36Q5CS`, register `com.classfunc.vowkey`. Debug and Release derive that ID from `BASE_BUNDLE_ID` in `ios/Configs/Common-bwpm.xcconfig`. The iOS extensions use `.autofill`, `.find-login-action-extension`, `.share-extension` and `.notification`; the Watch app uses `.watchkitapp`, with `.widget-extension` beneath it. Register the shared app group `group.com.classfunc.vowkey` and assign it to the app and its extensions.
2. Enable Push Notifications, Associated Domains, AutoFill Credential Provider and NFC Tag Reading for the main app as required by its entitlements. `ios/Vowkey/Application/Support/Vowkey.entitlements` declares `aps-environment` = `development`; App Store Connect export signs with `production`.
3. For CLASSFUNC push delivery, supply a CLASSFUNC APNs Auth Key (`.p8`), its Key ID and team ID, and set `APNS_TOPIC=com.classfunc.vowkey`. The relay's default topic remains `com.vowkey.app`; changing the iOS build does not change a running relay's credentials or environment. The same key serves sandbox and production, selected by `APNS_HOST`.

### Firebase

1. Create a Firebase project and add an Android app with package `com.vowkey.app`.
2. Download `google-services.json` to `android/app/src/standardRelease/google-services.json` and `android/app/src/standardBeta/google-services.json`. Both paths are gitignored. Debug builds use `com.vowkey.app.dev` (`applicationIdSuffix = ".dev"` in `android/app/build.gradle.kts`); register that package too if debug builds should receive pushes.
3. Create a service account with `Firebase Cloud Messaging API Admin` and save its JSON as `FCM_SERVICE_ACCOUNT_FILE`. The relay reads `project_id`, `client_email`, `private_key` and `token_uri`.

### Installation id

`site/host.html` posts `{email}` to `POST /installations` and shows the installation id, key and server configuration once. It calls `https://push.<page host>` by default; an explicit `?relay=https://push.example.com` selects another relay. Set `PUSH_RELAY_PUBLIC_ORIGIN` to the exact site origin serving the page. Only `/installations` accepts cross-origin browser requests from that origin; token and push calls remain server-to-server.

## Checks

```bash
node --test push-relay/test/relay.test.mjs
```

That uses stand-in APNs and FCM servers and a scratch SQLite file. It does not need the owner's keys.

A local server uses the same relay contract. Put a TLS listener in front of the relay and trust its certificate in the server container before enabling push; the server requires HTTPS for both push URIs. The loopback HTTP hosting override leaves push disabled and does not prove delivery.

### Android emulator

Needs the Firebase project and `google-services.json` above. Edit an item in the web vault. The emulator's Vowkey app should sync. The FCM data is:

```json
{"type":"0","payload":"{\"id\":\"<cipher uuid>\",\"userId\":\"<user uuid>\",\"revisionDate\":\"<rfc3339>\"}","contextId":"<acting device identifier>"}
```

### iOS simulator

Real APNs needs a device and `APNS_KEY_FILE`. Without them, this payload checks that the app handles the notification. `contextId` must differ from the simulator app's own identifier, or the app treats it as its own edit and ignores it.

```bash
xcrun simctl push booted com.classfunc.vowkey - <<'JSON'
{"Simulator Target Bundle":"com.classfunc.vowkey","aps":{"content-available":1},"data":{"type":1,"payload":"{\"id\":\"90eeb69a-722f-48be-8ab1-b0df01105e2a\",\"userId\":\"0efb0a6a-691e-490d-85d4-af5800dd267a\",\"revisionDate\":\"2026-11-04T00:00:00.000Z\"}","contextId":"relay"}}
JSON
```

The simulator build's bundle ID is `com.classfunc.vowkey` for both Debug and Release.

## Recipients

For a personal item, `push_cipher_update` sends to its owner. For an organization item, it finds confirmed members and sends separately to those who can access the item. Registration includes the person's confirmed organization ids; direct organization sends from an installation can also address those registrations.

Registration stores `deviceId`, `pushToken`, `userId`, `type`, `identifier` and organization ids. `type` 0 is Android (FCM) and `type` 1 is iOS (APNs). The acting device (`identifier`) is skipped. A body `installationId` is ignored; the bearer decides the installation. APNs `410` and FCM `UNREGISTERED` delete the token.
