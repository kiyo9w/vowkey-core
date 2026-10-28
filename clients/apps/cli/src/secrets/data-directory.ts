import * as fs from "fs";
import * as path from "path";

/**
 * The CLI's data directory. `ServiceContainer` and the secrets owner resolve it with this one
 * algorithm, so the state file, the sockets and the account data sit together.
 */
export function resolveCliDataDirectory(): string {
  const relativeDataDir = path.join(path.dirname(process.execPath), "vowkey-data");
  if (fs.existsSync(relativeDataDir)) {
    return relativeDataDir;
  }
  if (process.env.VOWKEYCLI_APPDATA_DIR) {
    return path.resolve(process.env.VOWKEYCLI_APPDATA_DIR);
  }
  if (process.platform === "darwin") {
    return path.join(process.env.HOME ?? "", "Library/Application Support/Vowkey CLI");
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? "", "Vowkey CLI");
  }
  if (process.env.XDG_CONFIG_HOME) {
    return path.join(process.env.XDG_CONFIG_HOME, "Vowkey CLI");
  }
  return path.join(process.env.HOME ?? "", ".config/Vowkey CLI");
}
