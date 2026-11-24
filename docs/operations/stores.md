# Stores

Accounts, certificates and listings belong to the owner. This page is the order of operations and the vendor rule that decides each one. Prices below are what the vendor publishes; the amount charged is the one shown at payment.

Listing copy is drafted in `vowkey-growth/approval-queue/05-platform-store-listings.md`. It is not submitted until the owner approves that file.

## Chrome Web Store

Register at the [developer dashboard](https://chrome.google.com/webstore/devconsole). Google charges a one-time registration fee before the first item can be published. The account email cannot be changed later. Vietnam is on the [supported regions list](https://developer.chrome.com/docs/webstore/register).

The privacy tab matches `store-listings.md`: no sale of user data, no advertising use, and crash reports only after the person turns them on.

## Firefox

Create an add-on account at `addons.mozilla.org` and submit the Firefox build (`dist/apps/browser/firefox`). The manifest declares `data_collection_permissions.required: none` and `technicalAndInteraction` as optional, requested only when the person turns on usage counts or crash reports. AMO account creation does not show a fee on its registration page.

## Apple

Vowkey iOS uses **CLASSFUNC SOFTWARES JOINT STOCK COMPANY**, Apple Developer team `98VU36Q5CS`. The App Store Connect record is **Vowkey**, bundle ID `com.classfunc.vowkey`. This is a separate installation from the personal-team app and uses the same backend at `https://vault.vowkey.app`.

`ios/Configs/Common-bwpm.xcconfig` owns the team, bundle ID and app group `group.com.classfunc.vowkey`. The four iOS extensions, Watch app and Watch widget derive their identifiers from the same base. A gitignored `Configs/Local-bwpm.xcconfig` can override these settings for a developer's machine.

Generate the projects and archive from `ios/`:

```bash
LOCAL_SDK=true mint run xcodegen --spec project-bwk.yml
LOCAL_SDK=true mint run xcodegen --spec project-pm.yml
CI=1 xcodebuild archive -workspace Vowkey.xcworkspace -scheme Vowkey \
  -configuration Release -destination 'generic/platform=iOS' \
  -archivePath build/Vowkey-Classfunc.xcarchive -allowProvisioningUpdates
xcodebuild -exportArchive -archivePath build/Vowkey-Classfunc.xcarchive \
  -exportPath build/Classfunc -exportOptionsPlist Configs/ExportOptions-Classfunc.plist \
  -allowProvisioningUpdates
```

The export produces an App Store Connect IPA with automatic signing and preserves the source version and build number. Increase `CURRENT_PROJECT_VERSION` in `project-pm.yml` for each upload. The export supports external TestFlight review; it is not restricted to internal testing.

Upload under the CLASSFUNC provider, then complete the TestFlight beta description, feedback email, What to Test and reviewer contact details before submitting the build to external beta review. Public App Store submission is a separate action.

Domain association and APNs are tied to the signing identity. The backend's Apple association must authorize `98VU36Q5CS.com.classfunc.vowkey` for web credentials or universal links to work. CLASSFUNC push delivery needs its APNs key and topic as described in `push.md`. Changing the app's identity does not change the deployed backend, association file or push credentials.

## Google Play

Register in Play Console. Google charges a one-time registration fee at account creation.

A personal account created after 13 November 2023 cannot ship to production until a closed test has at least 12 testers opted in continuously for the 14 days before the production-access application. A tester who opts out does not count, and the 14 days must be consecutive. Start the closed test before the launch date. Internal testing has no such wait and does not satisfy the requirement. Production and open testing stay locked until Google approves the application, which Google says usually takes seven days or less.

Package name `com.vowkey.app`.

## Microsoft Store

Create the developer account at [storedeveloper.microsoft.com](https://storedeveloper.microsoft.com). Microsoft does not charge a registration fee. An MSIX package submitted to the Store is re-signed by Microsoft, so the direct installer certificate is not required for that path. An MSI or EXE installer submitted to the Store still has to be signed by the publisher.

## Mac, outside the App Store

`clients/apps/desktop/electron-builder.json` signs with a Developer ID and notarizes in `scripts/after-sign.js`.

1. In Certificates, Identifiers & Profiles, create a Developer ID Application certificate for `com.vowkey.desktop`.
2. Set `CSC_NAME` to that identity. On a local build the after-pack script uses the first valid identity it finds unless `CSC_NAME` is set.
3. Notarize with an App Store Connect API key: `APP_STORE_CONNECT_TEAM_ISSUER`, `APP_STORE_CONNECT_AUTH_KEY_ID`, `APP_STORE_CONNECT_AUTH_KEY_PATH`. The script uses `notarytool`.
4. `APPLE_NOTARIZE=no` skips notarization. Leave it unset for a release.
5. Staple the ticket to the notarized app: `xcrun stapler staple "Vowkey.app"`, then `xcrun stapler validate "Vowkey.app"`.

`npm run pack:mac` in `clients/apps/desktop` builds the universal disk image and zip.

## Windows

Azure Artifact Signing is not available to an individual developer outside the United States and Canada. Microsoft's current rule: Public Trust certificates for individuals require the developer to be located in the United States or Canada, and the Azure billing account must be an individual account whose legal name and address match the government id. A Vietnam-based individual does not qualify.

Two routes remain:

- Ship the MSIX through the Microsoft Store. Microsoft re-signs it. No purchased certificate.
- Sign the direct installer (NSIS, portable, exe) with a purchased code-signing certificate from a CA in the Microsoft Trusted Root Program. `clients/apps/desktop/sign.js` already signs with `signtool.exe` when `ELECTRON_BUILDER_SIGN_CERT` is the PKCS#12 file and `ELECTRON_BUILDER_SIGN_CERT_PW` is its password. The Azure path in that file (`azuresigntool`, `SIGNING_VAULT_URL`) is the route this individual cannot use.

Set `ELECTRON_BUILDER_SIGN=0` so the Azure branch does not run. SmartScreen reputation builds across releases signed by the same identity; a new certificate warns until it has reputation. Microsoft removed the EV instant-reputation behavior in 2024, so an EV certificate is not a faster path.

## Desktop updater

`electron-builder.json` publishes with the generic provider to `https://vowkey.app/releases`. Each release uploads, for every platform it built:

- macOS: the zip, `latest-mac.yml`
- Windows: the NSIS web installer and `latest.yml`
- Linux: the AppImage and `latest-linux.yml`

The app checks that URL through `electron-updater` (`clients/apps/desktop/src/main/updater.main.ts`). Keep each metadata file and its referenced artifact from the same build; the metadata carries artifact checksums, while platform signing verifies the executable. Host the directory over HTTPS on the owner's release host.

## Affiliates, after payments open

Rewardful and Tolt both connect to Paddle. Once the owner chooses one, create the affiliate campaign and connect its Paddle integration in that vendor's dashboard. Follow its instructions for its own Paddle webhook destination and referral attribution. Keep the server's billing destination and `PADDLE_WEBHOOK_SECRET` unchanged: a second destination has its own signing secret. Verify a referred sandbox checkout and its refund in both dashboards before publishing affiliate links. Commission amounts are the owner's choice.

Reviewer access is for reviewing the product, with ordinary subscription terms rather than lifetime offers or artificial scarcity.

Reviewer access, once paid plans exist, is an admin grant (`entitlements.md`), not a coupon code in the client.

## Launch list

These are already drafted. Each waits for the owner's approval of that file, then goes out. Nothing here is sent by this runbook.

| Piece | File |
| --- | --- |
| Social and paid video scripts | `vowkey-growth/approval-queue/01-social-ads-vi-ja-en.md` |
| Show HN, Zenn, Qiita, Viblo | `vowkey-growth/approval-queue/02-developer-launch-hn-zenn-qiita-viblo.md` |
| Community replies | `vowkey-growth/approval-queue/03-community-answers-batch-1.md` |
| Office outreach | `vowkey-growth/approval-queue/04-b2b-warm-and-cold-outreach.md` |
| Store listings | `vowkey-growth/approval-queue/05-platform-store-listings.md` |
