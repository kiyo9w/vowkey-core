#!/usr/bin/env bash
set -eo pipefail

cd "$(dirname "$0")"

# Move to the root of the repository
cd ../

VERSION=$(grep '^version = ".*"' Cargo.toml | cut -d '"' -f 2)

# Delete old directory to ensure all files are updated
rm -rf crates/vowkey-api-api/src

# Generate new API bindings
npx openapi-generator-cli generate \
    -i artifacts/api.json \
    -g rust \
    -o crates/vowkey-api-api \
    --package-name vowkey-api-api \
    -t ./support/openapi-template \
    --additional-properties=library=reqwest-trait,mockall,topLevelApiClient,supportMiddleware=true,packageVersion=$VERSION,packageDescription=\"API bindings for the Vowkey API.\"

npm run prettier
