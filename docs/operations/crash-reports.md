# Crash reports

The app's “Send crash reports” switch enables the official Sentry SDK against Vowkey's Bugsink server. It starts off. Reports retain the error class, sanitized stack, app version and operating system. Exception messages, page addresses, breadcrumbs, field values and account identifiers are removed before transport. Sentry's per-event id and timestamp are transport metadata, not an account or installation identifier.

## Local server

Set `BUGSINK_SECRET_KEY`, `BUGSINK_ADMIN_EMAIL` and `BUGSINK_ADMIN_PASSWORD` in the environment, then run from the repository root:

```sh
docker-compose -f docs/operations/bugsink-compose.yml up -d
```

The port binds to loopback; `BUGSINK_PORT` defaults to 8000. Open that port, create a team, then one project for each app surface: web, extension, desktop, iOS and Android. Set Bugsink's public base URL to the address clients can reach. For an emulator or phone, loopback is that device, not this Mac.

Copy each project DSN into its server setting:

| Surface | Setting |
| --- | --- |
| Web vault | `CRASH_DSN_WEB` |
| Browser extension | `CRASH_DSN_EXTENSION` |
| Desktop | `CRASH_DSN_DESKTOP` |
| iOS | `CRASH_DSN_IOS` |
| Android | `CRASH_DSN_ANDROID` |

`GET /api/config` returns `crashDsns` with `web`, `extension`, `desktop`, `ios` and `android`. Each app reads only its own value. An empty DSN leaves reporting inactive even when the switch is on. The vault apps use Sentry, not Crashlytics; the separate Authenticator product retains its existing reporter.

## Verify a configuration

With a synthetic account, trigger a known exception containing a synthetic private value and form URL. While the switch is off, confirm no envelope request is sent. Enable it and confirm an issue appears in the correct Bugsink project with the version and OS, but without either synthetic value. Turn it off and repeat, then re-enable it and confirm delivery resumes.
