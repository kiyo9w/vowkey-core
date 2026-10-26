/* eslint-disable no-console */

/// Ensure that `sdk-internal` and `commercial-sdk-internal` dependencies have matching versions.

import fs from "fs";
import path from "path";

const packageJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8"),
);

const sdkInternal = packageJson.dependencies["@vowkey/sdk-internal"];
const commercialSdkInternal = packageJson.dependencies["@vowkey/commercial-sdk-internal"];

if (sdkInternal !== commercialSdkInternal) {
  console.error(
    `Version mismatch between @vowkey/sdk-internal (${sdkInternal}) and @vowkey/commercial-sdk-internal (${commercialSdkInternal}), must be an exact match.`,
  );
  process.exit(1);
}

console.log(`All dependencies have matching versions: ${sdkInternal}`);
