# Vowkey push relay

A Vowkey server tells the phone apps that something in the vault changed. It does not hold the APNs key or the FCM service account. It sends the change to this relay, which delivers it. The notification is the sync type and the ids of what changed. The vault stays on the server.

`docs/operations/push.md` is the setup: the Apple key, the Firebase project, the installation id, and the server settings.

Node 22 or later, no packages. `node serve.mjs` starts it. `node --test test/relay.test.mjs` runs it against a scratch database and stand-in APNs and FCM servers.
