#!/usr/bin/env bash
# Packages Vowkey's distributable release artifacts into `dist/`:
#   1. dist/vowkey-browser-chrome.zip          — Chrome / Edge / Brave extension bundle
#   2. dist/vowkey-cli-mcp-macos-arm64.tar.gz  — Standalone `vowkey` CLI + `vowkey-mcp` + `vowkey-read`
#   3. dist/Vowkey-macOS-arm64.dmg             — Standalone macOS Vowkey.app disk image with bundled `vowkey-read`
#   4. dist/Formula/vowkey.rb                  — Homebrew tap formula
#   5. dist/SHA256SUMS.txt                     — Checksums for all release artifacts

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
mkdir -p "$DIST/Formula"

echo "==> 1. Packaging Chrome / Edge / Brave Extension (vowkey-browser-chrome.zip)..."
BROWSER_BUILD="$ROOT/clients/apps/browser/build"
if [ ! -f "$BROWSER_BUILD/manifest.json" ]; then
  echo "Building browser extension..."
  npm --prefix "$ROOT/clients" run build:chrome --workspace @vowkey/browser
fi
rm -f "$DIST/vowkey-browser-chrome.zip"
(
  cd "$BROWSER_BUILD"
  zip -qr "$DIST/vowkey-browser-chrome.zip" . -x "*.map"
)

echo "==> 2. Packaging Vowkey CLI + MCP Server + Native OCR Helper (vowkey-cli-mcp-macos-arm64.tar.gz)..."
STAGE_CLI="$(mktemp -d)"
trap 'rm -rf "$STAGE_CLI"' EXIT
mkdir -p "$STAGE_CLI/vowkey/bin" "$STAGE_CLI/vowkey/cli" "$STAGE_CLI/vowkey/mcp"

cp -R "$ROOT/clients/apps/cli/build/"* "$STAGE_CLI/vowkey/cli/" 2>/dev/null || true
rm -f "$STAGE_CLI/vowkey/cli/"*.map
if [ -d "$ROOT/mcp/dist" ]; then
  cp -R "$ROOT/mcp/dist/"* "$STAGE_CLI/vowkey/mcp/"
  cp "$ROOT/mcp/package.json" "$STAGE_CLI/vowkey/mcp/"
fi
if [ -f "$ROOT/clients/apps/desktop/desktop_native/ocr/vowkey-read" ]; then
  cp "$ROOT/clients/apps/desktop/desktop_native/ocr/vowkey-read" "$STAGE_CLI/vowkey/bin/vowkey-read"
  chmod +x "$STAGE_CLI/vowkey/bin/vowkey-read"
fi
cp "$ROOT/scripts/open-read.py" "$STAGE_CLI/vowkey/bin/open-read.py"
chmod +x "$STAGE_CLI/vowkey/bin/open-read.py"

cat > "$STAGE_CLI/vowkey/bin/vowkey" <<'EOF'
#!/usr/bin/env bash
DIR="$(cd "$(dirname "$0")/.." && pwd)"
export VOWKEY_READ_HELPER="$DIR/bin/vowkey-read"
exec node "$DIR/cli/vowkey.js" "$@"
EOF
chmod +x "$STAGE_CLI/vowkey/bin/vowkey"

cat > "$STAGE_CLI/vowkey/bin/vowkey-mcp" <<'EOF'
#!/usr/bin/env bash
DIR="$(cd "$(dirname "$0")/.." && pwd)"
export VOWKEY_READ_HELPER="$DIR/bin/vowkey-read"
exec node "$DIR/mcp/index.js" "$@"
EOF
chmod +x "$STAGE_CLI/vowkey/bin/vowkey-mcp"

tar -czf "$DIST/vowkey-cli-mcp-macos-arm64.tar.gz" -C "$STAGE_CLI" vowkey

echo "==> 3. Packaging macOS Desktop App (Vowkey-macOS-arm64.dmg)..."
ELECTRON_APP="$ROOT/clients/node_modules/electron/dist/Electron.app"
DESKTOP_BUILD="$ROOT/clients/apps/desktop/build"
DMG_STAGE="$(mktemp -d)"
APP_BUNDLE="$DMG_STAGE/Vowkey.app"

cp -R "$ELECTRON_APP" "$APP_BUNDLE"
mkdir -p "$APP_BUNDLE/Contents/Resources/app"

# Copy current desktop build without stale wasm or source maps
rsync -a \
  --exclude="*.map" \
  --exclude="00ac028f5dc48d38fc1f.module.wasm" \
  --exclude="3f7bdc76e7e99b67aad5.module.wasm" \
  --exclude="3fe86ecc5ef13d2ed538.module.wasm" \
  --exclude="5ead0410f8ba357f90d0.module.wasm" \
  --exclude="8ef2279382a15241f43d.module.wasm" \
  --exclude="90a8e48a1861289131a2.module.wasm" \
  --exclude="98b30b9a10c9d3998a96.module.wasm" \
  --exclude="a6218abcc492dae88a2f.module.wasm" \
  --exclude="a9ac471fb1754bb2d249.module.wasm" \
  --exclude="c6259b2e106139ff071a.module.wasm" \
  --exclude="d27263093a680d7e1553.module.wasm" \
  --exclude="f83edf923f08aa5238dc.module.wasm" \
  "$DESKTOP_BUILD/" "$APP_BUNDLE/Contents/Resources/app/"

if [ -f "$ROOT/clients/apps/desktop/desktop_native/ocr/vowkey-read" ]; then
  cp "$ROOT/clients/apps/desktop/desktop_native/ocr/vowkey-read" "$APP_BUNDLE/Contents/Resources/vowkey-read"
  chmod +x "$APP_BUNDLE/Contents/Resources/vowkey-read"
fi
cp "$ROOT/scripts/open-read.py" "$APP_BUNDLE/Contents/Resources/open-read.py"
chmod +x "$APP_BUNDLE/Contents/Resources/open-read.py"

/usr/libexec/PlistBuddy -c "Set :CFBundleName Vowkey" "$APP_BUNDLE/Contents/Info.plist" || true
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName Vowkey" "$APP_BUNDLE/Contents/Info.plist" || true
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.vowkey.desktop" "$APP_BUNDLE/Contents/Info.plist" || true
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString 2026.10.2" "$APP_BUNDLE/Contents/Info.plist" || true

SIGN_IDENTITY="${VOWKEY_SIGN_IDENTITY:-$(security find-identity -v -p codesigning | awk -F'"' '/Apple Development|Developer ID Application/ {print $2; exit}')}"
if [ -z "$SIGN_IDENTITY" ]; then
  SIGN_IDENTITY="-"
fi
echo "==> Signing Vowkey.app with identity: $SIGN_IDENTITY"
ENTITLEMENTS="$DMG_STAGE/entitlements.plist"
cat > "$ENTITLEMENTS" <<'EOF'
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
  <key>com.apple.security.cs.allow-dyld-environment-variables</key>
  <true/>
</dict>
</plist>
EOF

xattr -cr "$APP_BUNDLE" || true
if [ -f "$APP_BUNDLE/Contents/Resources/vowkey-read" ]; then
  codesign --force --sign "$SIGN_IDENTITY" --entitlements "$ENTITLEMENTS" "$APP_BUNDLE/Contents/Resources/vowkey-read"
fi
codesign --force --deep --sign "$SIGN_IDENTITY" --entitlements "$ENTITLEMENTS" "$APP_BUNDLE"
rm -f "$ENTITLEMENTS"
codesign --verify --deep --strict "$APP_BUNDLE"
echo "    Verified signature on Vowkey.app (exit 0)"

ln -s /Applications "$DMG_STAGE/Applications"
rm -f "$DIST/Vowkey-macOS-arm64.dmg"
hdiutil create -volname "Vowkey" -srcfolder "$DMG_STAGE" -ov -format UDZO "$DIST/Vowkey-macOS-arm64.dmg" >/dev/null
if [ "$SIGN_IDENTITY" != "-" ]; then
  codesign --force --sign "$SIGN_IDENTITY" "$DIST/Vowkey-macOS-arm64.dmg" || true
fi
rm -rf "$DMG_STAGE"

echo "==> 4. Packaging Windows Desktop App (Vowkey-Windows-x64.zip)..."
ELECTRON_CACHE="$HOME/Library/Caches/electron"
mkdir -p "$ELECTRON_CACHE"
WIN_ELECTRON_ZIP="$ELECTRON_CACHE/electron-v43.5.0-win32-x64.zip"
if [ ! -f "$WIN_ELECTRON_ZIP" ]; then
  echo "    Downloading electron-v43.5.0-win32-x64.zip..."
  curl -sSL -o "$WIN_ELECTRON_ZIP" "https://github.com/electron/electron/releases/download/v43.5.0/electron-v43.5.0-win32-x64.zip"
fi
WIN_STAGE="$(mktemp -d)"
WIN_DIR="$WIN_STAGE/Vowkey-Windows-x64"
mkdir -p "$WIN_DIR"
unzip -q "$WIN_ELECTRON_ZIP" -d "$WIN_DIR"
mv "$WIN_DIR/electron.exe" "$WIN_DIR/Vowkey.exe"
rm -rf "$WIN_DIR/resources/default_app.asar"
mkdir -p "$WIN_DIR/resources/app"
rsync -a \
  --exclude="*.map" \
  --exclude="00ac028f5dc48d38fc1f.module.wasm" \
  --exclude="3f7bdc76e7e99b67aad5.module.wasm" \
  --exclude="3fe86ecc5ef13d2ed538.module.wasm" \
  --exclude="5ead0410f8ba357f90d0.module.wasm" \
  --exclude="8ef2279382a15241f43d.module.wasm" \
  --exclude="90a8e48a1861289131a2.module.wasm" \
  --exclude="98b30b9a10c9d3998a96.module.wasm" \
  --exclude="a6218abcc492dae88a2f.module.wasm" \
  --exclude="a9ac471fb1754bb2d249.module.wasm" \
  --exclude="c6259b2e106139ff071a.module.wasm" \
  --exclude="d27263093a680d7e1553.module.wasm" \
  --exclude="f83edf923f08aa5238dc.module.wasm" \
  "$DESKTOP_BUILD/" "$WIN_DIR/resources/app/"
cp "$ROOT/scripts/open-read.py" "$WIN_DIR/resources/open-read.py"
cat > "$WIN_DIR/resources/vowkey-read.cmd" <<'EOF'
@echo off
python "%~dp0open-read.py" %*
EOF
rm -f "$DIST/Vowkey-Windows-x64.zip"
(
  cd "$WIN_STAGE"
  zip -qr "$DIST/Vowkey-Windows-x64.zip" Vowkey-Windows-x64
)
rm -rf "$WIN_STAGE"

echo "==> 5. Generating Homebrew Formula and SHA256SUMS.txt..."
CLI_SHA="$(shasum -a 256 "$DIST/vowkey-cli-mcp-macos-arm64.tar.gz" | awk '{print $1}')"
DMG_SHA="$(shasum -a 256 "$DIST/Vowkey-macOS-arm64.dmg" | awk '{print $1}')"

cat > "$DIST/Formula/vowkey.rb" <<EOF
class Vowkey < Formula
  desc "Read documents into profiles, sync logins & keys, and fill forms or AI agent tasks via @vk: references"
  homepage "https://vowkey.com"
  url "https://github.com/kiyo9w/vowkey/releases/download/v2026.10.2/vowkey-cli-mcp-macos-arm64.tar.gz"
  version "2026.10.2"
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
  shasum -a 256 vowkey-browser-chrome.zip vowkey-cli-mcp-macos-arm64.tar.gz Vowkey-macOS-arm64.dmg Vowkey-Windows-x64.zip > SHA256SUMS.txt
)

echo "==> Done! Release artifacts in $DIST:"
ls -lh "$DIST"
cat "$DIST/SHA256SUMS.txt"
