#!/usr/bin/env bash
# Packages Vowkey's distributable release artifacts into `dist/`:
#   1. dist/Vowkey-Chrome-Extension.zip (+ vowkey-browser-chrome.zip)
#   2. dist/vowkey-cli-mcp-macos-arm64.tar.gz
#   3. dist/Vowkey-macOS-arm64.dmg (Developer ID Application signed; notarized unless VOWKEY_SKIP_NOTARIZE=1)
#   4. dist/Vowkey-Windows-x64.zip (with cross-compiled native N-API, desktop_proxy.exe, vowkey-read.exe & branded Vowkey.exe)
#   5. dist/Vowkey-Linux-x86_64.tar.gz (with bundled @vowkey/desktop-napi JS fallback + CLI/MCP host)
#   6. dist/Formula/vowkey.rb
#   7. dist/SHA256SUMS.txt

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
VERSION="${VOWKEY_RELEASE_VERSION:-2026.11.0}"
WIN_FILE_VERSION="$(echo "$VERSION" | awk -F. '{printf "%d.%d.%d.0", $1, $2, $3}')"
TEAM_ID="${VOWKEY_APPLE_TEAM_ID:-9ASJ75KP6N}"

node_major="$(sed 's/^v//; s/\..*//' "$ROOT/clients/.nvmrc")"
node_home="$(brew --prefix "node@$node_major" 2>/dev/null || true)"
[ -d "$node_home/bin" ] && export PATH="$node_home/bin:$PATH"

mkdir -p "$DIST/Formula"

echo "==> 1. Packaging Chrome / Edge / Brave / Arc Extension..."
BROWSER_BUILD="$ROOT/clients/apps/browser/build"
if [ "${VOWKEY_SKIP_BROWSER_BUILD:-0}" != "1" ]; then
  echo "Building browser extension..."
  rm -rf "$BROWSER_BUILD"
  npm --prefix "$ROOT/clients" run build:prod:chrome --workspace @vowkey/browser
fi
rm -f "$DIST/Vowkey-Chrome-Extension.zip" "$DIST/vowkey-browser-chrome.zip"
(
  cd "$BROWSER_BUILD"
  zip -qr "$DIST/Vowkey-Chrome-Extension.zip" . -x "*.map"
)
cp "$DIST/Vowkey-Chrome-Extension.zip" "$DIST/vowkey-browser-chrome.zip"

echo "==> 2. Packaging Vowkey CLI + MCP Server + Native OCR Helper (vowkey-cli-mcp-macos-arm64.tar.gz)..."
if [ "${VOWKEY_SKIP_CLI_BUILD:-0}" != "1" ]; then
  echo "Building Vowkey CLI..."
  rm -rf "$ROOT/clients/apps/cli/build"
  VOWKEY_BUNDLE_STANDALONE=1 npm --prefix "$ROOT/clients" run build:oss:prod --workspace @vowkey/cli
fi
if [ "${VOWKEY_SKIP_MCP_BUILD:-0}" != "1" ]; then
  echo "Building Vowkey MCP server..."
  rm -rf "$ROOT/mcp/dist"
  npm --prefix "$ROOT/mcp" run build
fi
STAGE_CLI="$(mktemp -d)"
trap 'rm -rf "$STAGE_CLI"' EXIT
mkdir -p "$STAGE_CLI/vowkey/bin" "$STAGE_CLI/vowkey/cli" "$STAGE_CLI/vowkey/mcp"

cp -R "$ROOT/clients/apps/cli/build/"* "$STAGE_CLI/vowkey/cli/" 2>/dev/null || true
rm -f "$STAGE_CLI/vowkey/cli/"*.map
if [ -d "$ROOT/mcp/dist" ]; then
  npx --yes esbuild "$ROOT/mcp/dist/index.js" \
    --bundle --platform=node --target=node22 --format=esm \
    --outfile="$STAGE_CLI/vowkey/mcp/index.js"
  chmod +x "$STAGE_CLI/vowkey/mcp/index.js"
  cat > "$STAGE_CLI/vowkey/mcp/package.json" <<'MCPEOF'
{
  "name": "@vowkey/mcp-server",
  "type": "module",
  "main": "index.js"
}
MCPEOF
fi
if [ -f "$ROOT/clients/apps/desktop/desktop_native/ocr/vowkey-read" ]; then
  cp "$ROOT/clients/apps/desktop/desktop_native/ocr/vowkey-read" "$STAGE_CLI/vowkey/bin/vowkey-read"
  chmod +x "$STAGE_CLI/vowkey/bin/vowkey-read"
fi
cp "$ROOT/scripts/open-read.py" "$STAGE_CLI/vowkey/bin/open-read.py"
chmod +x "$STAGE_CLI/vowkey/bin/open-read.py"

cat > "$STAGE_CLI/vowkey/bin/vowkey" <<'EOF'
#!/usr/bin/env bash
SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
  LINK_DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ "$SOURCE" != /* ]] && SOURCE="$LINK_DIR/$SOURCE"
done
DIR="$(cd -P "$(dirname "$SOURCE")/.." && pwd)"
export VOWKEY_READ_HELPER="${VOWKEY_READ_HELPER:-$DIR/bin/vowkey-read}"
exec node "$DIR/cli/vowkey.js" "$@"
EOF
chmod +x "$STAGE_CLI/vowkey/bin/vowkey"

cat > "$STAGE_CLI/vowkey/bin/vowkey-mcp" <<'EOF'
#!/usr/bin/env bash
SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
  LINK_DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ "$SOURCE" != /* ]] && SOURCE="$LINK_DIR/$SOURCE"
done
DIR="$(cd -P "$(dirname "$SOURCE")/.." && pwd)"
export VOWKEY_READ_HELPER="${VOWKEY_READ_HELPER:-$DIR/bin/vowkey-read}"
export VOWKEY_CLI_PATH="${VOWKEY_CLI_PATH:-$DIR/cli/vowkey.js}"
exec node "$DIR/mcp/index.js" "$@"
EOF
chmod +x "$STAGE_CLI/vowkey/bin/vowkey-mcp"

tar -czf "$DIST/vowkey-cli-mcp-macos-arm64.tar.gz" -C "$STAGE_CLI" vowkey

bundle_desktop_napi() {
  local app_dir="$1"
  local platform_glob="$2"
  local napi_src="$ROOT/clients/apps/desktop/desktop_native/napi"
  local napi_dst="$app_dir/node_modules/@vowkey/desktop-napi"
  mkdir -p "$napi_dst"
  cp "$napi_src/package.json" "$napi_src/index.js" "$napi_dst/"
  [ -f "$napi_src/index.d.ts" ] && cp "$napi_src/index.d.ts" "$napi_dst/"
  for node_bin in "$napi_src"/$platform_glob; do
    if [ -f "$node_bin" ]; then
      cp "$node_bin" "$napi_dst/"
    fi
  done
}

bundle_cli_and_mcp_resources() {
  local res_dir="$1"
  if [ -d "$ROOT/clients/apps/cli/build" ]; then
    mkdir -p "$res_dir/cli"
    rsync -a --exclude="*.map" "$ROOT/clients/apps/cli/build/" "$res_dir/cli/"
  fi
  if [ -d "$STAGE_CLI/vowkey/mcp" ]; then
    mkdir -p "$res_dir/mcp"
    rsync -a "$STAGE_CLI/vowkey/mcp/" "$res_dir/mcp/"
  fi
}

echo "==> 3. Packaging macOS Desktop App (Vowkey-macOS-arm64.dmg)..."
DESKTOP_BUILD="$ROOT/clients/apps/desktop/build"
if [ "${VOWKEY_SKIP_DESKTOP_BUILD:-0}" != "1" ]; then
  echo "Building production desktop bundle..."
  rm -rf "$DESKTOP_BUILD"
  npm --prefix "$ROOT/clients" run build --workspace @vowkey/desktop
fi
ELECTRON_APP="$ROOT/clients/node_modules/electron/dist/Electron.app"
MAC_WORK="$(mktemp -d)"
ARCHIVE_DIR="$MAC_WORK/Vowkey.xcarchive"
mkdir -p "$ARCHIVE_DIR/Products/Applications"
APP_BUNDLE="$ARCHIVE_DIR/Products/Applications/Vowkey.app"

cp -R "$ELECTRON_APP" "$APP_BUNDLE"
rm -rf "$APP_BUNDLE/Contents/Resources/default_app.asar"
mkdir -p "$APP_BUNDLE/Contents/Resources/app"
rsync -a --exclude="*.map" "$DESKTOP_BUILD/" "$APP_BUNDLE/Contents/Resources/app/"
bundle_desktop_napi "$APP_BUNDLE/Contents/Resources/app" "desktop_napi.darwin-*.node"
bundle_cli_and_mcp_resources "$APP_BUNDLE/Contents/Resources"

if [ -f "$ROOT/clients/apps/desktop/desktop_native/ocr/vowkey-read" ]; then
  cp "$ROOT/clients/apps/desktop/desktop_native/ocr/vowkey-read" "$APP_BUNDLE/Contents/Resources/vowkey-read"
  chmod +x "$APP_BUNDLE/Contents/Resources/vowkey-read"
fi
cp "$ROOT/scripts/open-read.py" "$APP_BUNDLE/Contents/Resources/open-read.py"
chmod +x "$APP_BUNDLE/Contents/Resources/open-read.py"

if [ -f "$ROOT/clients/apps/desktop/desktop_native/dist/desktop_proxy.darwin-arm64" ]; then
  cp "$ROOT/clients/apps/desktop/desktop_native/dist/desktop_proxy.darwin-arm64" "$APP_BUNDLE/Contents/MacOS/desktop_proxy"
  cp "$ROOT/clients/apps/desktop/desktop_native/dist/desktop_proxy.darwin-arm64" "$APP_BUNDLE/Contents/MacOS/desktop_proxy.inherit"
  chmod +x "$APP_BUNDLE/Contents/MacOS/desktop_proxy" "$APP_BUNDLE/Contents/MacOS/desktop_proxy.inherit"
fi

if [ -f "$ROOT/clients/apps/desktop/resources/icon.icns" ]; then
  cp "$ROOT/clients/apps/desktop/resources/icon.icns" "$APP_BUNDLE/Contents/Resources/icon.icns"
  cp "$ROOT/clients/apps/desktop/resources/icon.icns" "$APP_BUNDLE/Contents/Resources/electron.icns"
fi
if [ -f "$APP_BUNDLE/Contents/MacOS/Electron" ]; then
  mv "$APP_BUNDLE/Contents/MacOS/Electron" "$APP_BUNDLE/Contents/MacOS/Vowkey"
fi

for suffix in "" " (GPU)" " (Plugin)" " (Renderer)"; do
  OLD_HELPER="$APP_BUNDLE/Contents/Frameworks/Electron Helper${suffix}.app"
  NEW_HELPER="$APP_BUNDLE/Contents/Frameworks/Vowkey Helper${suffix}.app"
  if [ -d "$OLD_HELPER" ]; then
    mv "$OLD_HELPER" "$NEW_HELPER"
    mv "$NEW_HELPER/Contents/MacOS/Electron Helper${suffix}" "$NEW_HELPER/Contents/MacOS/Vowkey Helper${suffix}"
    plutil -replace CFBundleExecutable -string "Vowkey Helper${suffix}" "$NEW_HELPER/Contents/Info.plist"
    plutil -replace CFBundleName -string "Vowkey Helper${suffix}" "$NEW_HELPER/Contents/Info.plist"
    plutil -replace CFBundleDisplayName -string "Vowkey Helper${suffix}" "$NEW_HELPER/Contents/Info.plist"
    plutil -replace CFBundleIdentifier -string "com.vowkey.desktop.helper" "$NEW_HELPER/Contents/Info.plist"
    plutil -replace CFBundleShortVersionString -string "${VERSION}" "$NEW_HELPER/Contents/Info.plist"
    plutil -replace CFBundleVersion -string "${VERSION}" "$NEW_HELPER/Contents/Info.plist"
  fi
done

plutil -replace CFBundleExecutable -string "Vowkey" "$APP_BUNDLE/Contents/Info.plist"
plutil -replace CFBundleIconFile -string "icon.icns" "$APP_BUNDLE/Contents/Info.plist"
plutil -replace CFBundleName -string "Vowkey" "$APP_BUNDLE/Contents/Info.plist"
plutil -replace CFBundleDisplayName -string "Vowkey" "$APP_BUNDLE/Contents/Info.plist"
plutil -replace CFBundleIdentifier -string "com.vowkey.desktop" "$APP_BUNDLE/Contents/Info.plist"
plutil -replace CFBundleShortVersionString -string "${VERSION}" "$APP_BUNDLE/Contents/Info.plist"
plutil -replace CFBundleVersion -string "${VERSION}" "$APP_BUNDLE/Contents/Info.plist"
plutil -replace LSApplicationCategoryType -string "public.app-category.productivity" "$APP_BUNDLE/Contents/Info.plist"
plutil -replace ElectronTeamID -string "${TEAM_ID}" "$APP_BUNDLE/Contents/Info.plist"
plutil -replace VowkeyAppGroupIdentifier -string "${TEAM_ID}.com.vowkey.desktop" "$APP_BUNDLE/Contents/Info.plist"
plutil -replace ITSAppUsesNonExemptEncryption -bool false "$APP_BUNDLE/Contents/Info.plist"
plutil -replace NSHumanReadableCopyright -string "Copyright © 2026 Vowkey Inc. All rights reserved." "$APP_BUNDLE/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Delete :CFBundleURLTypes" "$APP_BUNDLE/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes array" "$APP_BUNDLE/Contents/Info.plist" || true
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0 dict" "$APP_BUNDLE/Contents/Info.plist" || true
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLName string 'Vowkey URL'" "$APP_BUNDLE/Contents/Info.plist" || true
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" "$APP_BUNDLE/Contents/Info.plist" || true
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string 'vowkey'" "$APP_BUNDLE/Contents/Info.plist" || true

if [ -d "$ROOT/clients/apps/desktop/macos/dist/autofill-extension.appex" ]; then
  mkdir -p "$APP_BUNDLE/Contents/PlugIns"
  cp -R "$ROOT/clients/apps/desktop/macos/dist/autofill-extension.appex" "$APP_BUNDLE/Contents/PlugIns/autofill-extension.appex"
fi

PRE_SIGN_IDENTITY="$(security find-identity -v -p codesigning | awk -F'"' '/Developer ID Application/ {print $2; exit}')"
if [ -z "$PRE_SIGN_IDENTITY" ]; then
  PRE_SIGN_IDENTITY="$(security find-identity -v -p codesigning | awk -F'"' '/Apple Development/ {print $2; exit}')"
fi
if [ -z "$PRE_SIGN_IDENTITY" ]; then
  PRE_SIGN_IDENTITY="-"
fi

APP_GROUP_XML=""
if [ "$PRE_SIGN_IDENTITY" != "-" ]; then
  APP_GROUP_XML="  <key>com.apple.security.application-groups</key>
  <array>
    <string>${TEAM_ID}.com.vowkey.desktop</string>
  </array>"
fi

cat > "$MAC_WORK/main.entitlements" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
  <key>com.apple.security.automation.apple-events</key>
  <true/>
${APP_GROUP_XML}
</dict>
</plist>
EOF

cat > "$MAC_WORK/proxy.entitlements" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${APP_GROUP_XML}
</dict>
</plist>
EOF

cat > "$MAC_WORK/helper.entitlements" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
</dict>
</plist>
EOF

sign_bundle_inside_out() {
  local bundle="$1"
  local identity="$2"
  xattr -cr "$bundle" || true

  find "$bundle/Contents/Resources" -type f \( -name "*.node" -o -name "*.dylib" -o -name "vowkey-read" \) -print0 | while IFS= read -r -d '' bin; do
    codesign --force --options runtime --sign "$identity" "$bin"
  done

  for proxy in desktop_proxy desktop_proxy.inherit; do
    if [ -f "$bundle/Contents/MacOS/$proxy" ]; then
      codesign --force --options runtime --entitlements "$MAC_WORK/proxy.entitlements" --sign "$identity" -i "com.vowkey.desktop.$proxy" "$bundle/Contents/MacOS/$proxy"
    fi
  done

  local efw="$bundle/Contents/Frameworks/Electron Framework.framework"
  find "$efw/Versions/A/Libraries" -type f -name "*.dylib" -print0 2>/dev/null | while IFS= read -r -d '' dylib; do
    codesign --force --options runtime --sign "$identity" "$dylib"
  done
  if [ -f "$efw/Versions/A/Helpers/chrome_crashpad_handler" ]; then
    codesign --force --options runtime --sign "$identity" "$efw/Versions/A/Helpers/chrome_crashpad_handler"
  fi
  codesign --force --options runtime --sign "$identity" "$efw"

  for fw in Mantle.framework ReactiveObjC.framework Squirrel.framework; do
    if [ -d "$bundle/Contents/Frameworks/$fw" ]; then
      if [ -f "$bundle/Contents/Frameworks/$fw/Versions/A/Resources/ShipIt" ]; then
        codesign --force --options runtime --sign "$identity" "$bundle/Contents/Frameworks/$fw/Versions/A/Resources/ShipIt"
      fi
      codesign --force --options runtime --sign "$identity" "$bundle/Contents/Frameworks/$fw"
    fi
  done

  for suffix in "" " (GPU)" " (Plugin)" " (Renderer)"; do
    local helper="$bundle/Contents/Frameworks/Vowkey Helper${suffix}.app"
    if [ -d "$helper" ]; then
      codesign --force --options runtime --entitlements "$MAC_WORK/helper.entitlements" --sign "$identity" "$helper"
    fi
  done

  codesign --force --options runtime --entitlements "$MAC_WORK/main.entitlements" --sign "$identity" "$bundle"
}

echo "==> Pre-signing Vowkey.app inside-out with: $PRE_SIGN_IDENTITY"
sign_bundle_inside_out "$APP_BUNDLE" "$PRE_SIGN_IDENTITY"

FINAL_APP="$APP_BUNDLE"
if [ "${VOWKEY_SKIP_NOTARIZE:-0}" != "1" ] && command -v xcodebuild >/dev/null 2>&1 && [ "$PRE_SIGN_IDENTITY" != "-" ]; then
  cat > "$ARCHIVE_DIR/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>ApplicationProperties</key>
	<dict>
		<key>ApplicationPath</key>
		<string>Applications/Vowkey.app</string>
		<key>Architectures</key>
		<array>
			<string>arm64</string>
		</array>
		<key>CFBundleIdentifier</key>
		<string>com.vowkey.desktop</string>
		<key>CFBundleShortVersionString</key>
		<string>${VERSION}</string>
		<key>CFBundleVersion</key>
		<string>${VERSION}</string>
		<key>SigningIdentity</key>
		<string>${PRE_SIGN_IDENTITY}</string>
		<key>Team</key>
		<string>${TEAM_ID}</string>
	</dict>
	<key>ArchiveVersion</key>
	<integer>2</integer>
	<key>CreationDate</key>
	<date>$(date -u +"%Y-%m-%dT%H:%M:%SZ")</date>
	<key>Name</key>
	<string>Vowkey</string>
	<key>SchemeName</key>
	<string>Vowkey</string>
</dict>
</plist>
EOF

  cat > "$MAC_WORK/ExportUploadOptions.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>destination</key>
	<string>upload</string>
	<key>method</key>
	<string>developer-id</string>
	<key>signingStyle</key>
	<string>automatic</string>
	<key>teamID</key>
	<string>${TEAM_ID}</string>
</dict>
</plist>
EOF

  echo "==> Signing with Cloud-Managed Developer ID Application (${TEAM_ID}) and uploading to Apple Notary Service..."
  if ! xcodebuild -exportArchive \
      -archivePath "$ARCHIVE_DIR" \
      -exportOptionsPlist "$MAC_WORK/ExportUploadOptions.plist" \
      -exportPath "$MAC_WORK/upload" \
      -allowProvisioningUpdates; then
    if [ -d "$APP_BUNDLE/Contents/PlugIns/autofill-extension.appex" ]; then
      echo "    Retrying Developer ID notarization without unprovisioned PlugIns/autofill-extension.appex..."
      rm -rf "$APP_BUNDLE/Contents/PlugIns"
      sign_bundle_inside_out "$APP_BUNDLE" "$PRE_SIGN_IDENTITY"
      xcodebuild -exportArchive \
        -archivePath "$ARCHIVE_DIR" \
        -exportOptionsPlist "$MAC_WORK/ExportUploadOptions.plist" \
        -exportPath "$MAC_WORK/upload" \
        -allowProvisioningUpdates
    fi
  fi

  echo "==> Waiting for Apple Notary ticket and stapling Vowkey.app..."
  for attempt in $(seq 1 30); do
    if xcodebuild -exportNotarizedApp -archivePath "$ARCHIVE_DIR" -exportPath "$MAC_WORK/notarized" >/dev/null 2>&1; then
      FINAL_APP="$MAC_WORK/notarized/Vowkey.app"
      break
    fi
    echo "    Apple Notary processing (attempt $attempt/30)..."
    sleep 10
  done

  xcrun stapler validate "$FINAL_APP"
  spctl -a -t exec -vv "$FINAL_APP"
fi

codesign --verify --deep --strict "$FINAL_APP"
echo "    Verified signature & Gatekeeper acceptance on Vowkey.app"

DMG_STAGE="$MAC_WORK/dmg_stage"
mkdir -p "$DMG_STAGE"
cp -R "$FINAL_APP" "$DMG_STAGE/Vowkey.app"
ln -s /Applications "$DMG_STAGE/Applications"
if [ -f "$ROOT/clients/apps/desktop/resources/dmg.icns" ]; then
  cp "$ROOT/clients/apps/desktop/resources/dmg.icns" "$DMG_STAGE/.VolumeIcon.icns"
  SetFile -c icnC "$DMG_STAGE/.VolumeIcon.icns" 2>/dev/null || true
  SetFile -a C "$DMG_STAGE" 2>/dev/null || true
fi
rm -f "$DIST/Vowkey-macOS-arm64.dmg"
hdiutil create -volname "Vowkey" -srcfolder "$DMG_STAGE" -ov -format UDZO "$DIST/Vowkey-macOS-arm64.dmg" >/dev/null
rm -rf "$MAC_WORK"

echo "==> 4. Packaging Windows Desktop App (Vowkey-Windows-x64.zip)..."
ELECTRON_CACHE="$HOME/Library/Caches/electron"
mkdir -p "$ELECTRON_CACHE"
ELECTRON_VER="$(node -p "require('$ROOT/clients/node_modules/electron/package.json').version")"
WIN_ELECTRON_ZIP="$ELECTRON_CACHE/electron-v${ELECTRON_VER}-win32-x64.zip"
if [ ! -f "$WIN_ELECTRON_ZIP" ]; then
  echo "    Downloading electron-v${ELECTRON_VER}-win32-x64.zip..."
  curl -sSL -o "$WIN_ELECTRON_ZIP" "https://github.com/electron/electron/releases/download/v${ELECTRON_VER}/electron-v${ELECTRON_VER}-win32-x64.zip"
fi
WIN_STAGE="$(mktemp -d)"
WIN_DIR="$WIN_STAGE/Vowkey-Windows-x64"
mkdir -p "$WIN_DIR"
unzip -q "$WIN_ELECTRON_ZIP" -d "$WIN_DIR"
mv "$WIN_DIR/electron.exe" "$WIN_DIR/Vowkey.exe"
rm -rf "$WIN_DIR/resources/default_app.asar"
mkdir -p "$WIN_DIR/resources/app"
rsync -a --exclude="*.map" "$DESKTOP_BUILD/" "$WIN_DIR/resources/app/"
bundle_desktop_napi "$WIN_DIR/resources/app" "desktop_napi.win32-*.node"
bundle_cli_and_mcp_resources "$WIN_DIR/resources"

NATIVE_DIST="$ROOT/clients/apps/desktop/desktop_native/dist"
if [ -f "$NATIVE_DIST/desktop_proxy.win32-x64.exe" ]; then
  cp "$NATIVE_DIST/desktop_proxy.win32-x64.exe" "$WIN_DIR/desktop_proxy.exe"
  cp "$NATIVE_DIST/desktop_proxy.win32-x64.exe" "$WIN_DIR/resources/desktop_proxy.exe"
fi
if [ -f "$NATIVE_DIST/vowkey-read.win32-x64.exe" ]; then
  cp "$NATIVE_DIST/vowkey-read.win32-x64.exe" "$WIN_DIR/vowkey-read.exe"
  cp "$NATIVE_DIST/vowkey-read.win32-x64.exe" "$WIN_DIR/resources/vowkey-read.exe"
fi
if [ -f "$NATIVE_DIST/windows_plugin_authenticator.win32-x64.exe" ]; then
  cp "$NATIVE_DIST/windows_plugin_authenticator.win32-x64.exe" "$WIN_DIR/windows_plugin_authenticator.exe"
  cp "$NATIVE_DIST/windows_plugin_authenticator.win32-x64.exe" "$WIN_DIR/resources/windows_plugin_authenticator.exe"
fi
if [ -f "$NATIVE_DIST/vowkey_chromium_import_helper.win32-x64.exe" ]; then
  cp "$NATIVE_DIST/vowkey_chromium_import_helper.win32-x64.exe" "$WIN_DIR/vowkey_chromium_import_helper.exe"
  cp "$NATIVE_DIST/vowkey_chromium_import_helper.win32-x64.exe" "$WIN_DIR/resources/vowkey_chromium_import_helper.exe"
fi

cp "$ROOT/scripts/open-read.py" "$WIN_DIR/resources/open-read.py"
cp "$ROOT/scripts/win-ocr.ps1" "$WIN_DIR/resources/win-ocr.ps1"
if [ -f "$ROOT/clients/apps/desktop/resources/icon.ico" ]; then
  cp "$ROOT/clients/apps/desktop/resources/icon.ico" "$WIN_DIR/resources/icon.ico"
  echo "    Stamping Vowkey icon and PE metadata onto Vowkey.exe..."
  npx --yes resedit-cli@3.1.1 \
    --in "$WIN_DIR/Vowkey.exe" \
    --out "$WIN_DIR/Vowkey.exe" \
    --ignore-signed \
    --icon "1,$ROOT/clients/apps/desktop/resources/icon.ico" \
    --product-name "Vowkey" \
    --file-description "Vowkey" \
    --company-name "Vowkey Inc." \
    --internal-name "Vowkey" \
    --original-filename "Vowkey.exe" \
    --file-version "$WIN_FILE_VERSION" \
    --product-version "$WIN_FILE_VERSION"
fi

cat > "$WIN_DIR/resources/vowkey-read.cmd" <<'EOF'
@echo off
if exist "%~dp0vowkey-read.exe" (
  "%~dp0vowkey-read.exe" %*
  exit /b %ERRORLEVEL%
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0win-ocr.ps1" %*
EOF

rm -f "$DIST/Vowkey-Windows-x64.zip"
(
  cd "$WIN_STAGE"
  zip -qr "$DIST/Vowkey-Windows-x64.zip" Vowkey-Windows-x64
)
rm -rf "$WIN_STAGE"

echo "==> 5. Packaging Linux Desktop App (Vowkey-Linux-x86_64.tar.gz)..."
LINUX_ELECTRON_ZIP="$ELECTRON_CACHE/electron-v${ELECTRON_VER}-linux-x64.zip"
if [ ! -f "$LINUX_ELECTRON_ZIP" ]; then
  echo "    Downloading electron-v${ELECTRON_VER}-linux-x64.zip..."
  curl -sSL -o "$LINUX_ELECTRON_ZIP" "https://github.com/electron/electron/releases/download/v${ELECTRON_VER}/electron-v${ELECTRON_VER}-linux-x64.zip"
fi
LINUX_STAGE="$(mktemp -d)"
LINUX_DIR="$LINUX_STAGE/Vowkey-Linux-x86_64"
mkdir -p "$LINUX_DIR"
unzip -q "$LINUX_ELECTRON_ZIP" -d "$LINUX_DIR"
mv "$LINUX_DIR/electron" "$LINUX_DIR/vowkey"
chmod +x "$LINUX_DIR/vowkey"
rm -rf "$LINUX_DIR/resources/default_app.asar"
mkdir -p "$LINUX_DIR/resources/app"
rsync -a --exclude="*.map" "$DESKTOP_BUILD/" "$LINUX_DIR/resources/app/"
bundle_desktop_napi "$LINUX_DIR/resources/app" "desktop_napi.linux-*.node"
bundle_cli_and_mcp_resources "$LINUX_DIR/resources"
cp "$ROOT/scripts/open-read.py" "$LINUX_DIR/resources/vowkey-read"
chmod +x "$LINUX_DIR/resources/vowkey-read"
rm -f "$DIST/Vowkey-Linux-x86_64.tar.gz"
tar -czf "$DIST/Vowkey-Linux-x86_64.tar.gz" -C "$LINUX_STAGE" Vowkey-Linux-x86_64
rm -rf "$LINUX_STAGE"

echo "==> 6. Generating Homebrew Formula and SHA256SUMS.txt..."
CLI_SHA="$(shasum -a 256 "$DIST/vowkey-cli-mcp-macos-arm64.tar.gz" | awk '{print $1}')"

cat > "$DIST/Formula/vowkey.rb" <<EOF
class Vowkey < Formula
  desc "Read documents into profiles, sync logins & keys, and fill forms or AI agent tasks via @vk: references"
  homepage "https://vowkey.app"
  url "https://vowkey.app/releases/vowkey-cli-mcp-macos-arm64.tar.gz"
  version "${VERSION}"
  sha256 "${CLI_SHA}"
  license "GPL-3.0-only"

  depends_on "node"

  def install
    libexec.install Dir["*"]
    bin.install_symlink libexec/"bin/vowkey"
    bin.install_symlink libexec/"bin/vowkey-mcp"
    bin.install_symlink libexec/"bin/vowkey-read"
  end

  test do
    assert_match "2026", shell_output("#{bin}/vowkey --version", 0)
  end
end
EOF

(
  cd "$DIST"
  sum_files=(
    Vowkey-macOS-arm64.dmg
    Vowkey-Windows-x64.zip
    Vowkey-Linux-x86_64.tar.gz
  )
  [ -f Vowkey-Android.apk ] && sum_files+=(Vowkey-Android.apk)
  sum_files+=(
    Vowkey-Chrome-Extension.zip
    vowkey-browser-chrome.zip
    vowkey-cli-mcp-macos-arm64.tar.gz
  )
  shasum -a 256 "${sum_files[@]}" > SHA256SUMS.txt
)

echo "==> Done! Release artifacts in $DIST:"
ls -lh "$DIST"
cat "$DIST/SHA256SUMS.txt"
