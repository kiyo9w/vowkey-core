// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { existsSync, promises as fs } from "fs";
import { homedir, userInfo } from "os";
import * as path from "path";

import { ipcMain } from "electron";
import { Subject } from "rxjs";

import { LogService } from "@vowkey/common/platform/abstractions/log.service";
import {
  DesktopIpcPeerClientType,
  IpcClientTypeMessage,
  isIpcClientTypeMessage,
} from "@vowkey/common/platform/ipc";
import { agentSocketPath } from "@vowkey/common/vault/agent/node/broker";
import { ipc, windows_registry } from "@vowkey/desktop-napi";

import { isDev } from "../utils";

import { isWindowsStore } from "./platform-utils.main";
import { WindowMain } from "./window.main";

export class NativeMessagingMain {
  private ipcServer: ipc.NativeIpcServer | null;
  /** Connected clients by id, with the type each announced; `Unknown` until it announces. */
  private clients = new Map<number, DesktopIpcPeerClientType>();

  private _messages$ = new Subject<ipc.IpcMessage>();
  readonly messages$ = this._messages$.asObservable();

  constructor(
    private logService: LogService,
    private windowMain: WindowMain,
    private userPath: string,
    private exePath: string,
    private appPath: string,
  ) {
    ipcMain.handle(
      "nativeMessaging.manifests",
      async (_event: any, options: { create: boolean }) => {
        if (options.create) {
          try {
            await this.listen();
            await this.generateManifests();
          } catch (e) {
            this.logService.error("Error generating manifests: " + e);
            return e;
          }
        } else {
          this.stop();
          try {
            await this.removeManifests();
          } catch (e) {
            this.logService.error("Error removing manifests: " + e);
            return e;
          }
        }
        return null;
      },
    );

    ipcMain.handle(
      "nativeMessaging.ddgManifests",
      async (_event: any, options: { create: boolean }) => {
        if (options.create) {
          try {
            await this.listen();
            await this.generateDdgManifests();
          } catch (e) {
            this.logService.error("Error generating duckduckgo manifests: " + e);
            return e;
          }
        } else {
          this.stop();
          try {
            await this.removeDdgManifests();
          } catch (e) {
            this.logService.error("Error removing duckduckgo manifests: " + e);
            return e;
          }
        }
        return null;
      },
    );
  }

  async listen() {
    if (this.ipcServer) {
      this.ipcServer.stop();
    }
    this.logService.info("Starting native messaging server");
    this.ipcServer = await ipc.NativeIpcServer.listen("bw", (error, msg) => {
      switch (msg.kind) {
        case ipc.IpcMessageType.Connected: {
          const announcement = parseAnnouncement(msg.message);
          const clientType = announcement?.clientType ?? DesktopIpcPeerClientType.Unknown;
          this.clients.set(msg.clientId, clientType);

          // Only the known detail of an untrusted frame is logged.
          this.logService.info(
            `Native messaging client ${msg.clientId} has connected as ${clientType}`,
            { extensionId: announcement?.extensionId },
          );
          break;
        }
        case ipc.IpcMessageType.Disconnected: {
          this.clients.delete(msg.clientId);

          this.logService.info("Native messaging client " + msg.clientId + " has disconnected");
          break;
        }
        case ipc.IpcMessageType.Message:
          try {
            const msgJson = JSON.parse(msg.message);
            this.logService.debug("Native messaging message:", msgJson);
            this._messages$.next(msg);
            this.windowMain.win?.webContents.send("nativeMessaging", msgJson);
          } catch (e) {
            this.logService.warning("Error processing message:", e, msg.message);
          }
          break;

        default:
          this.logService.warning("Unknown message type:", msg.kind, msg.message);
          break;
      }
    });

    for (const path of this.ipcServer.getPaths()) {
      this.logService.info("Native messaging server started at:", path);
    }

    ipcMain.on("nativeMessagingReply", (event, msg) => {
      if (msg != null) {
        this.send(msg);
      }
    });
  }

  stop() {
    this.ipcServer?.stop();
  }

  /**
   * The client type a connected client announced, `Unknown` for one that announced none, or
   * `undefined` for a client that is not connected.
   *
   * `desktop_proxy` always announces, so `Unknown` also covers a proxy that predates the
   * announcement.
   */
  clientTypeFor(clientId: number): DesktopIpcPeerClientType | undefined {
    return this.clients.get(clientId);
  }

  send(message: object) {
    this.logService.debug("Native messaging reply:", message);
    this.ipcServer?.send(JSON.stringify(message));
  }

  sendTo(clientId: number, message: object) {
    this.logService.debug("Native messaging targeted reply to client", clientId, ":", message);
    this.ipcServer?.sendTo(clientId, JSON.stringify(message));
  }

  private async generateChromeJson(binaryPath: string) {
    return {
      name: "com.vowkey.app",
      description: "Vowkey desktop <-> browser bridge",
      path: binaryPath,
      type: "stdio",
      allowed_origins: await this.loadChromeIds(),
    };
  }

  private async generateFirefoxJson(binaryPath: string) {
    return {
      name: "com.vowkey.app",
      description: "Vowkey desktop <-> browser bridge",
      path: binaryPath,
      type: "stdio",
      allowed_extensions: ["{446900e4-71c2-419f-a6a7-df9c091e268b}"],
    };
  }

  private async generateAgentChromeJson(binaryPath: string) {
    return {
      name: "com.vowkey.agent",
      description: "Vowkey desktop <-> agent bridge",
      path: binaryPath,
      type: "stdio",
      allowed_origins: await this.loadChromeIds(),
    };
  }

  private async generateAgentFirefoxJson(binaryPath: string) {
    return {
      name: "com.vowkey.agent",
      description: "Vowkey desktop <-> agent bridge",
      path: binaryPath,
      type: "stdio",
      allowed_extensions: ["{446900e4-71c2-419f-a6a7-df9c091e268b}"],
    };
  }

  async generateManifests() {
    const proxyPath = this.binaryPath();
    const proxyExists = existsSync(proxyPath);
    // Browsers may not launch executables inside the Appx, only its execution aliases.
    const binaryPath = isWindowsStore() ? this.appxProxyAliasPath() : proxyPath;
    const agentBinaryPath = await this.resolveAgentHostBinaryPath(binaryPath);

    await this.writeAgentDiscoveryManifests(agentBinaryPath);

    if (!proxyExists) {
      await this.writeStandaloneAgentBrowserManifests(agentBinaryPath);
      throw new Error(`Unable to find proxy binary: ${proxyPath}`);
    }

    // When debugging against a dedicated chrome profile, only that profile gets a
    // manifest, so the real browser installs are left untouched.
    if (this.debugChromeProfileDir() != null) {
      await this.generateDebugChromeManifest(binaryPath, agentBinaryPath);
      return;
    }

    switch (process.platform) {
      case "win32": {
        const destination = this.windowsManifestDirectory();
        await this.writeManifest(
          path.join(destination, "firefox.json"),
          await this.generateFirefoxJson(binaryPath),
        );
        await this.writeManifest(
          path.join(destination, "chrome.json"),
          await this.generateChromeJson(binaryPath),
        );
        await this.writeManifest(
          path.join(destination, "agent-firefox.json"),
          await this.generateAgentFirefoxJson(agentBinaryPath),
        );
        await this.writeManifest(
          path.join(destination, "agent-chrome.json"),
          await this.generateAgentChromeJson(agentBinaryPath),
        );

        const nmhs = this.getWindowsNMHS();
        for (const [name, [key, subkey]] of Object.entries(nmhs)) {
          let manifestPath = path.join(destination, "chrome.json");
          if (name === "Firefox") {
            manifestPath = path.join(destination, "firefox.json");
          }
          await windows_registry.createKey(key, subkey, manifestPath);
        }

        const agentNmhs = this.getWindowsAgentNMHS();
        for (const [name, [key, subkey]] of Object.entries(agentNmhs)) {
          let manifestPath = path.join(destination, "agent-chrome.json");
          if (name === "Firefox") {
            manifestPath = path.join(destination, "agent-firefox.json");
          }
          await windows_registry.createKey(key, subkey, manifestPath);
        }
        break;
      }
      case "darwin": {
        const nmhs = this.getDarwinNMHS();
        for (const [key, browserDirectory] of Object.entries(nmhs)) {
          if (existsSync(browserDirectory)) {
            const nmhsPath = path.join(browserDirectory, "NativeMessagingHosts");
            const manifestPath = path.join(nmhsPath, "com.vowkey.app.json");
            const agentManifestPath = path.join(nmhsPath, "com.vowkey.agent.json");

            let manifest: any = await this.generateChromeJson(binaryPath);
            let agentManifest: any = await this.generateAgentChromeJson(agentBinaryPath);
            if (key === "Firefox" || key === "Zen") {
              // Only generate the NMHS dir if the browser directory exists
              await fs.mkdir(nmhsPath, { recursive: true });
              manifest = await this.generateFirefoxJson(binaryPath);
              agentManifest = await this.generateAgentFirefoxJson(agentBinaryPath);
            }

            await this.writeManifest(manifestPath, manifest);
            await this.writeManifest(agentManifestPath, agentManifest);
          } else {
            this.logService.warning(`${key} not found, skipping.`);
          }
        }
        break;
      }
      case "linux": {
        // Because on linux, the path inside the sandbox is different, and we want to support:
        // Flatpak App, Unsandboxed App, Flatpak Browser, Unsandboxed Browser, Snap App, Unsandboxed App
        // and any combination of the above, we copy the binary to the applications native-messaging-hosts path
        // so that a canonical path to put in the manifest can be used.

        // Unsandboxed browser
        await this.createFirefoxDir(
          `${this.homedir()}/.config/mozilla/`,
          `${this.homedir()}/.mozilla`,
        );
        for (const [key, browserDirectory] of Object.entries(this.getLinuxNMHS())) {
          if (existsSync(browserDirectory)) {
            let nhmsPath = path.join(browserDirectory, "NativeMessagingHosts");
            if (key === "Firefox") {
              nhmsPath = path.join(browserDirectory, "native-messaging-hosts");
            }
            const browserBinaryPath = path.join(nhmsPath, ".vowkey_desktop_proxy");
            const browserAgentPath = existsSync(agentBinaryPath)
              ? path.join(nhmsPath, ".vowkey_agent_host")
              : browserBinaryPath;

            // Only generate the NMHS dir if the browser directory exists
            await fs.mkdir(nhmsPath, { recursive: true });

            await this.linkOrCopy(binaryPath, browserBinaryPath);
            if (browserAgentPath !== browserBinaryPath) {
              await this.linkOrCopy(agentBinaryPath, browserAgentPath);
            }
            this.logService.info(
              `[Native messaging] Hard-linked ${binaryPath} to ${browserBinaryPath}`,
            );

            if (key === "Firefox") {
              await this.writeManifest(
                path.join(nhmsPath, "com.vowkey.app.json"),
                await this.generateFirefoxJson(browserBinaryPath),
              );
              await this.writeManifest(
                path.join(nhmsPath, "com.vowkey.agent.json"),
                await this.generateAgentFirefoxJson(browserAgentPath),
              );
            } else {
              await this.writeManifest(
                path.join(nhmsPath, "com.vowkey.app.json"),
                await this.generateChromeJson(browserBinaryPath),
              );
              await this.writeManifest(
                path.join(nhmsPath, "com.vowkey.agent.json"),
                await this.generateAgentChromeJson(browserAgentPath),
              );
            }
          } else {
            this.logService.warning(`${key} not found, skipping.`);
          }
        }

        await this.createFirefoxDir(
          `${this.homedir()}/.var/app/org.mozilla.firefox`,
          this.getFlatpakNMHS().Firefox,
        );
        for (const [key, value] of Object.entries(this.getFlatpakNMHS())) {
          if (existsSync(value)) {
            const sandboxedProxyBinaryPath = path.join(value, ".vowkey_desktop_proxy");
            const sandboxedAgentPath = existsSync(agentBinaryPath)
              ? path.join(value, ".vowkey_agent_host")
              : sandboxedProxyBinaryPath;
            await this.linkOrCopy(binaryPath, sandboxedProxyBinaryPath);
            if (sandboxedAgentPath !== sandboxedProxyBinaryPath) {
              await this.linkOrCopy(agentBinaryPath, sandboxedAgentPath);
            }
            this.logService.info(
              `[Native messaging] Hard-linked ${binaryPath} to ${sandboxedProxyBinaryPath}`,
            );

            if (key === "Firefox") {
              await this.writeManifest(
                path.join(value, "com.vowkey.app.json"),
                await this.generateFirefoxJson(sandboxedProxyBinaryPath),
              );
              await this.writeManifest(
                path.join(value, "com.vowkey.agent.json"),
                await this.generateAgentFirefoxJson(sandboxedAgentPath),
              );
            } else if (key === "Chrome" || key === "Chromium" || key === "Microsoft Edge") {
              await this.writeManifest(
                path.join(value, "com.vowkey.app.json"),
                await this.generateChromeJson(sandboxedProxyBinaryPath),
              );
              await this.writeManifest(
                path.join(value, "com.vowkey.agent.json"),
                await this.generateAgentChromeJson(sandboxedAgentPath),
              );
            } else {
              this.logService.warning(`Flatpak ${key} not supported, skipping.`);
            }
          } else {
            this.logService.warning(`${key} not found, skipping.`);
          }
        }

        break;
      }
      default:
        break;
    }
  }

  // Chrome only reads per-profile NativeMessagingHosts directories on macOS and Linux;
  // on Windows it discovers hosts through the registry, which is shared with the
  // installed client, so the debug profile is not supported there.
  private debugChromeProfileDir(): string | null {
    const profileDir = process.env.VOWKEY_CHROME_PROFILE_DIR;

    if (!profileDir) {
      return null;
    }

    if (process.platform === "win32") {
      this.logService.warning(
        "[Native messaging] VOWKEY_CHROME_PROFILE_DIR is not supported on Windows, ignoring it",
      );
      return null;
    }

    return profileDir;
  }

  // Allow pointing chrome at a custom local profile for debugging
  private async generateDebugChromeManifest(binaryPath: string, agentBinaryPath: string) {
    const profileDir = this.debugChromeProfileDir();

    if (!profileDir) {
      return;
    }

    const nmhsPath = path.join(profileDir, "NativeMessagingHosts");
    await fs.mkdir(nmhsPath, { recursive: true });

    await this.writeManifest(
      path.join(nmhsPath, "com.vowkey.app.json"),
      await this.generateChromeJson(binaryPath),
    );
    await this.writeManifest(
      path.join(nmhsPath, "com.vowkey.agent.json"),
      await this.generateAgentChromeJson(agentBinaryPath),
    );
  }

  /**
   * Installs browser `com.vowkey.agent.json` manifests even when `desktop_proxy` has not been
   * compiled yet, so browser and AI agent native-host connections still work out-of-the-box.
   */
  private async writeStandaloneAgentBrowserManifests(agentBinaryPath: string) {
    if (!existsSync(agentBinaryPath)) {
      return;
    }
    if (this.debugChromeProfileDir() != null) {
      const nmhsPath = path.join(this.debugChromeProfileDir(), "NativeMessagingHosts");
      await fs.mkdir(nmhsPath, { recursive: true });
      await this.writeManifest(
        path.join(nmhsPath, "com.vowkey.agent.json"),
        await this.generateAgentChromeJson(agentBinaryPath),
      );
      return;
    }
    if (process.platform === "darwin") {
      for (const [key, browserDirectory] of Object.entries(this.getDarwinNMHS())) {
        if (existsSync(browserDirectory)) {
          const nmhsPath = path.join(browserDirectory, "NativeMessagingHosts");
          const agentManifest =
            key === "Firefox" || key === "Zen"
              ? await this.generateAgentFirefoxJson(agentBinaryPath)
              : await this.generateAgentChromeJson(agentBinaryPath);
          if (key === "Firefox" || key === "Zen") {
            await fs.mkdir(nmhsPath, { recursive: true });
          }
          await this.writeManifest(path.join(nmhsPath, "com.vowkey.agent.json"), agentManifest);
        }
      }
    } else if (process.platform === "win32") {
      const destination = this.windowsManifestDirectory();
      await this.writeManifest(
        path.join(destination, "agent-firefox.json"),
        await this.generateAgentFirefoxJson(agentBinaryPath),
      );
      await this.writeManifest(
        path.join(destination, "agent-chrome.json"),
        await this.generateAgentChromeJson(agentBinaryPath),
      );
      for (const [name, [key, subkey]] of Object.entries(this.getWindowsAgentNMHS())) {
        const manifestPath = path.join(
          destination,
          name === "Firefox" ? "agent-firefox.json" : "agent-chrome.json",
        );
        await windows_registry.createKey(key, subkey, manifestPath);
      }
    }
  }

  async generateDdgManifests() {
    const manifest = {
      name: "com.vowkey.app",
      description: "Vowkey desktop <-> DuckDuckGo bridge",
      path: this.binaryPath(),
      type: "stdio",
    };

    if (!existsSync(manifest.path)) {
      throw new Error(`Unable to find binary: ${manifest.path}`);
    }

    switch (process.platform) {
      case "darwin": {
        /* eslint-disable-next-line no-useless-escape */
        const path = `${this.homedir()}/Library/Containers/com.duckduckgo.macos.browser/Data/Library/Application\ Support/NativeMessagingHosts/com.vowkey.app.json`;
        await this.writeManifest(path, manifest);
        break;
      }
      default:
        break;
    }
  }

  async removeManifests() {
    for (const discoveryPath of this.agentDiscoveryPaths()) {
      await this.removeIfExists(discoveryPath);
    }

    switch (process.platform) {
      case "win32": {
        const destination = this.windowsManifestDirectory();
        await this.removeIfExists(path.join(destination, "firefox.json"));
        await this.removeIfExists(path.join(destination, "chrome.json"));
        await this.removeIfExists(path.join(destination, "agent-firefox.json"));
        await this.removeIfExists(path.join(destination, "agent-chrome.json"));

        const nmhs = this.getWindowsNMHS();
        for (const [, [key, subkey]] of Object.entries(nmhs)) {
          await windows_registry.deleteKey(key, subkey);
        }
        for (const [, [key, subkey]] of Object.entries(this.getWindowsAgentNMHS())) {
          await windows_registry.deleteKey(key, subkey);
        }
        break;
      }
      case "darwin": {
        const nmhs = this.getDarwinNMHS();
        for (const [, value] of Object.entries(nmhs)) {
          await this.removeIfExists(
            path.join(value, "NativeMessagingHosts", "com.vowkey.app.json"),
          );
          await this.removeIfExists(
            path.join(value, "NativeMessagingHosts", "com.vowkey.agent.json"),
          );
        }
        break;
      }
      case "linux": {
        for (const [key, value] of Object.entries(this.getLinuxNMHS())) {
          if (key === "Firefox") {
            await this.removeIfExists(
              path.join(value, "native-messaging-hosts", "com.vowkey.app.json"),
            );
            await this.removeIfExists(
              path.join(value, "native-messaging-hosts", "com.vowkey.agent.json"),
            );
            await this.removeIfExists(
              path.join(value, "native-messaging-hosts", ".vowkey_agent_host"),
            );
          } else {
            await this.removeIfExists(
              path.join(value, "NativeMessagingHosts", "com.vowkey.app.json"),
            );
            await this.removeIfExists(
              path.join(value, "NativeMessagingHosts", "com.vowkey.agent.json"),
            );
            await this.removeIfExists(
              path.join(value, "NativeMessagingHosts", ".vowkey_agent_host"),
            );
          }
        }

        for (const [, value] of Object.entries(this.getFlatpakNMHS())) {
          await this.removeIfExists(path.join(value, "com.vowkey.app.json"));
          await this.removeIfExists(path.join(value, "com.vowkey.agent.json"));
          await this.removeIfExists(path.join(value, ".vowkey_desktop_proxy"));
          await this.removeIfExists(path.join(value, ".vowkey_agent_host"));
        }

        break;
      }
      default:
        break;
    }
  }

  async removeDdgManifests() {
    switch (process.platform) {
      case "darwin": {
        /* eslint-disable-next-line no-useless-escape */
        const path = `${this.homedir()}/Library/Containers/com.duckduckgo.macos.browser/Data/Library/Application\ Support/NativeMessagingHosts/com.vowkey.app.json`;
        await this.removeIfExists(path);
        break;
      }
      default:
        break;
    }
  }

  /*
    Helper functions to get the native messaging host paths for each platform.

    Note that for the chromium-based browsers (Edge, Brave, Vivaldi, etc.) they
    usually fallback to checking Chrome's NativeMessagingHosts path if the manifest
    is not found in their own path, but we still want to install the manifest in their
    own path as well if possible on macOS and Linux.

    This is because our code requires the browser paths to exist before installing the manifest,
    so the fallback included in these browsers won't work if the user hasn't installed Chrome
    first (or some other application created the folder for them).
  */

  private getWindowsNMHS() {
    return {
      Firefox: ["HKCU", "SOFTWARE\\Mozilla\\NativeMessagingHosts\\com.vowkey.app"],
      Chrome: ["HKCU", "SOFTWARE\\Google\\Chrome\\NativeMessagingHosts\\com.vowkey.app"],
      Chromium: ["HKCU", "SOFTWARE\\Chromium\\NativeMessagingHosts\\com.vowkey.app"],
      "Microsoft Edge": [
        "HKCU",
        "SOFTWARE\\Microsoft\\Edge\\NativeMessagingHosts\\com.vowkey.app",
      ],
      Vivaldi: ["HKCU", "SOFTWARE\\Vivaldi\\NativeMessagingHosts\\com.vowkey.app"],
      Brave: [
        "HKCU",
        "SOFTWARE\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\com.vowkey.app",
      ],
    };
  }

  private getWindowsAgentNMHS() {
    return {
      Firefox: ["HKCU", "SOFTWARE\\Mozilla\\NativeMessagingHosts\\com.vowkey.agent"],
      Chrome: ["HKCU", "SOFTWARE\\Google\\Chrome\\NativeMessagingHosts\\com.vowkey.agent"],
      Chromium: ["HKCU", "SOFTWARE\\Chromium\\NativeMessagingHosts\\com.vowkey.agent"],
      "Microsoft Edge": [
        "HKCU",
        "SOFTWARE\\Microsoft\\Edge\\NativeMessagingHosts\\com.vowkey.agent",
      ],
      Vivaldi: ["HKCU", "SOFTWARE\\Vivaldi\\NativeMessagingHosts\\com.vowkey.agent"],
      Brave: [
        "HKCU",
        "SOFTWARE\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\com.vowkey.agent",
      ],
    };
  }

  private resolveCliDirectoryForPlatform(): string {
    if (process.env.VOWKEYCLI_APPDATA_DIR) {
      return path.resolve(process.env.VOWKEYCLI_APPDATA_DIR);
    }
    const home = this.homedir();
    if (process.platform === "darwin") {
      return path.join(home, "Library", "Application Support", "Vowkey CLI");
    }
    if (process.platform === "win32") {
      const appData = process.env.APPDATA;
      if (appData && path.isAbsolute(appData)) {
        return path.join(appData, "Vowkey CLI");
      }
      return path.join(this.windowsManifestDirectory(), "..", "Vowkey CLI");
    }
    if (process.env.XDG_CONFIG_HOME && path.isAbsolute(process.env.XDG_CONFIG_HOME)) {
      return path.join(process.env.XDG_CONFIG_HOME, "Vowkey CLI");
    }
    return path.join(home, ".config", "Vowkey CLI");
  }

  private agentSupportDirectory(): string | null {
    if (process.platform === "win32") {
      const dir = this.windowsManifestDirectory();
      return path.isAbsolute(dir) ? dir : null;
    }
    return path.isAbsolute(this.userPath) ? this.userPath : null;
  }

  private agentDiscoveryPaths(): string[] {
    const destinations: string[] = [];
    const supportDir = this.agentSupportDirectory();
    if (supportDir != null && existsSync(path.dirname(supportDir))) {
      destinations.push(path.join(supportDir, "com.vowkey.agent.json"));
    }
    const cliDir = this.resolveCliDirectoryForPlatform();
    if (path.isAbsolute(cliDir) && existsSync(path.dirname(cliDir))) {
      const cliManifest = path.join(cliDir, "com.vowkey.agent.json");
      if (!destinations.includes(cliManifest)) {
        destinations.push(cliManifest);
      }
    }
    return destinations;
  }

  private resolveCliEntrypoints(): {
    cliBinary?: string;
    cliScript?: string;
    mcpBinary?: string;
    mcpScript?: string;
  } {
    const ext = process.platform === "win32" ? ".cmd" : "";
    const exeDir = path.dirname(this.exePath);
    const binCandidates = [
      process.env.VOWKEY_CLI_PATH,
      path.join(exeDir, `vowkey${process.platform === "win32" ? ".exe" : ""}`),
      path.join(exeDir, `vowkey${ext}`),
      ...(process.platform === "darwin"
        ? ["/opt/homebrew/bin/vowkey", "/usr/local/bin/vowkey"]
        : process.platform === "linux"
          ? ["/usr/local/bin/vowkey", "/usr/bin/vowkey"]
          : []),
    ].filter((candidate): candidate is string => Boolean(candidate));

    const scriptCandidates = [
      path.resolve(this.appPath, "../../cli/build/vowkey.js"),
      path.resolve(this.appPath, "../cli/build/vowkey.js"),
      path.resolve(exeDir, "../Resources/cli/vowkey.js"),
      path.resolve(exeDir, "resources/cli/vowkey.js"),
    ];

    const mcpBinCandidates = [
      path.join(exeDir, `vowkey-mcp${ext}`),
      ...(process.platform === "darwin"
        ? ["/opt/homebrew/bin/vowkey-mcp", "/usr/local/bin/vowkey-mcp"]
        : process.platform === "linux"
          ? ["/usr/local/bin/vowkey-mcp", "/usr/bin/vowkey-mcp"]
          : []),
    ];

    const mcpScriptCandidates = [
      path.resolve(this.appPath, "../../../mcp/dist/index.js"),
      path.resolve(this.appPath, "../../../../mcp/dist/index.js"),
      path.resolve(exeDir, "../Resources/mcp/index.js"),
      path.resolve(exeDir, "resources/mcp/index.js"),
    ];

    const foundBin = binCandidates.find((c) => existsSync(c));
    const foundScript = scriptCandidates.find((c) => existsSync(c));
    const foundMcpBin = mcpBinCandidates.find((c) => existsSync(c));
    const foundMcpScript = mcpScriptCandidates.find((c) => existsSync(c));

    return {
      cliBinary: foundBin?.endsWith(".js") ? undefined : foundBin,
      cliScript: foundBin?.endsWith(".js") ? foundBin : foundScript,
      mcpBinary: foundMcpBin,
      mcpScript: foundMcpScript,
    };
  }

  private async resolveAgentHostBinaryPath(fallbackBinaryPath: string): Promise<string> {
    const ext = process.platform === "win32" ? ".exe" : "";
    const directHost = path.join(path.dirname(this.exePath), `vowkey-agent-host${ext}`);
    if (existsSync(directHost)) {
      return directHost;
    }

    const supportDir = this.agentSupportDirectory();
    const { cliBinary, cliScript } = this.resolveCliEntrypoints();
    if (supportDir == null || !existsSync(path.dirname(supportDir)) || (!cliBinary && !cliScript)) {
      return fallbackBinaryPath;
    }

    await fs.mkdir(supportDir, { recursive: true });
    if (process.platform === "win32") {
      const shimPath = path.join(supportDir, "vowkey-agent-host.cmd");
      const commandLine = cliBinary
        ? `"${cliBinary}" native-host %*`
        : existsSync(this.exePath)
          ? `set ELECTRON_RUN_AS_NODE=1\r\n"${this.exePath}" "${cliScript}" native-host %*`
          : `node "${cliScript}" native-host %*`;
      await fs.writeFile(shimPath, `@echo off\r\n${commandLine}\r\n`, "utf8");
      return shimPath;
    }

    const shimPath = path.join(supportDir, "vowkey-agent-host");
    const commandLine = cliBinary
      ? `exec "${cliBinary}" native-host "$@"`
      : existsSync(this.exePath)
        ? `ELECTRON_RUN_AS_NODE=1 exec "${this.exePath}" "${cliScript}" native-host "$@"`
        : `exec node "${cliScript}" native-host "$@"`;
    await fs.writeFile(shimPath, `#!/bin/sh\n${commandLine}\n`, { mode: 0o755 });
    await fs.chmod(shimPath, 0o755);
    return shimPath;
  }

  private async writeAgentDiscoveryManifests(agentBinaryPath: string) {
    const cliDataDirectory = this.resolveCliDirectoryForPlatform();
    const { cliBinary, cliScript, mcpBinary, mcpScript } = this.resolveCliEntrypoints();
    const mcpServer = mcpBinary
      ? { command: mcpBinary, args: [] as string[] }
      : mcpScript
        ? { command: "node", args: [mcpScript] }
        : { command: "vowkey-mcp", args: [] as string[] };

    const discoveryManifest = {
      name: "com.vowkey.agent",
      description: "Vowkey desktop agent broker and MCP discovery manifest",
      protocol: "vowkey.agent.v1",
      cliDataDirectory,
      socketPath: agentSocketPath(cliDataDirectory),
      credentialFile: path.join(cliDataDirectory, "agent", "mcp-pairing.json"),
      nativeHostPath: agentBinaryPath,
      cliPath: cliBinary ?? cliScript ?? null,
      mcpServer,
    };

    for (const destination of this.agentDiscoveryPaths()) {
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await this.writeManifest(destination, discoveryManifest);
    }
  }

  private getDarwinNMHS() {
    /* eslint-disable no-useless-escape */
    return {
      Firefox: `${this.homedir()}/Library/Application\ Support/Mozilla/`,
      Chrome: `${this.homedir()}/Library/Application\ Support/Google/Chrome/`,
      "Chrome Beta": `${this.homedir()}/Library/Application\ Support/Google/Chrome\ Beta/`,
      "Chrome Dev": `${this.homedir()}/Library/Application\ Support/Google/Chrome\ Dev/`,
      "Chrome Canary": `${this.homedir()}/Library/Application\ Support/Google/Chrome\ Canary/`,
      Chromium: `${this.homedir()}/Library/Application\ Support/Chromium/`,
      "Microsoft Edge": `${this.homedir()}/Library/Application\ Support/Microsoft\ Edge/`,
      "Microsoft Edge Beta": `${this.homedir()}/Library/Application\ Support/Microsoft\ Edge\ Beta/`,
      "Microsoft Edge Dev": `${this.homedir()}/Library/Application\ Support/Microsoft\ Edge\ Dev/`,
      "Microsoft Edge Canary": `${this.homedir()}/Library/Application\ Support/Microsoft\ Edge\ Canary/`,
      Vivaldi: `${this.homedir()}/Library/Application\ Support/Vivaldi/`,
      Zen: `${this.homedir()}/Library/Application\ Support/Zen/`,
      Helium: `${this.homedir()}/Library/Application\ Support/net.imput.helium/`,
      Brave: `${this.homedir()}/Library/Application\ Support/BraveSoftware/Brave-Browser/`,
      "Brave Beta": `${this.homedir()}/Library/Application\ Support/BraveSoftware/Brave-Browser-Beta/`,
      "Brave Nightly": `${this.homedir()}/Library/Application\ Support/BraveSoftware/Brave-Browser-Nightly/`,
    };
    /* eslint-enable no-useless-escape */
  }

  private getLinuxNMHS() {
    return {
      Firefox: `${this.homedir()}/.mozilla/`,
      Chrome: `${this.homedir()}/.config/google-chrome/`,
      Chromium: `${this.homedir()}/.config/chromium/`,
      "Microsoft Edge": `${this.homedir()}/.config/microsoft-edge/`,
      Vivaldi: `${this.homedir()}/.config/vivaldi/`,
      Brave: `${this.homedir()}/.config/BraveSoftware/Brave-Browser/`,
      Helium: `${this.homedir()}/.config/net.imput.helium/`,
    };
  }

  // Firefox may be installed without the dir it reads native messaging hosts from
  // (e.g. XDG profiles in ~/.config/mozilla, no ~/.mozilla). Create it so Firefox is detected.
  // E.g. firefoxDir: ~/.config/mozilla/, hostsDir: ~/.mozilla
  private async createFirefoxDir(firefoxDir: string, hostsDir: string) {
    if (!existsSync(firefoxDir)) {
      return;
    }

    await fs.mkdir(hostsDir, { recursive: true });
  }

  private getFlatpakNMHS() {
    return {
      Firefox: `${this.homedir()}/.var/app/org.mozilla.firefox/.mozilla/native-messaging-hosts/`,
      Chrome: `${this.homedir()}/.var/app/com.google.Chrome/config/google-chrome/NativeMessagingHosts/`,
      Chromium: `${this.homedir()}/.var/app/org.chromium.Chromium/config/chromium/NativeMessagingHosts/`,
      "Microsoft Edge": `${this.homedir()}/.var/app/com.microsoft.Edge/config/microsoft-edge/NativeMessagingHosts/`,
    };
  }

  private async writeManifest(destination: string, manifest: object) {
    this.logService.debug(`Writing manifest: ${destination}`);

    if (!existsSync(path.dirname(destination))) {
      await fs.mkdir(path.dirname(destination));
    }

    await fs.writeFile(destination, JSON.stringify(manifest, null, 2));
  }

  private async loadChromeIds(): Promise<string[]> {
    const configured = (process.env.VOWKEY_BROWSER_EXTENSION_IDS ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => /^[a-p]{32}$/.test(entry))
      .map((entry) => `chrome-extension://${entry}/`);
    const ids: Set<string> = new Set(configured);

    if (!isDev()) {
      return Array.from(ids);
    }

    // The dev builds of the extension have a different random ID per user, so to make development easier
    // we try to find the extension IDs from the user's Chrome profiles when we're running in dev mode.
    let chromePaths: string[];
    switch (process.platform) {
      case "darwin": {
        chromePaths = Object.entries(this.getDarwinNMHS())
          .filter(([key]) => key !== "Firefox")
          .map(([, value]) => value);
        break;
      }
      case "linux": {
        chromePaths = Object.entries(this.getLinuxNMHS())
          .filter(([key]) => key !== "Firefox")
          .map(([, value]) => value);
        break;
      }
      case "win32": {
        // TODO: Add more supported browsers for Windows?
        chromePaths = [
          path.join(process.env.LOCALAPPDATA, "Microsoft", "Edge", "User Data"),
          path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "User Data"),
        ];
        break;
      }
    }

    const debugProfileDir = this.debugChromeProfileDir();
    if (debugProfileDir != null) {
      chromePaths.push(debugProfileDir);
    }

    for (const chromePath of chromePaths) {
      try {
        // The chrome profile directories are named "Default", "Profile 1", "Profile 2", etc.
        const profiles = (await fs.readdir(chromePath)).filter((f) => {
          const lower = f.toLowerCase();
          return lower == "default" || lower.startsWith("profile ");
        });

        for (const profile of profiles) {
          // Chrome writes keyboard-shortcut assignments to "Preferences" only when "was_assigned"
          // is true. Freshly-loaded dev extensions may have the correct commands in
          // "Secure Preferences" but not yet in "Preferences", so scan both files.
          for (const prefsFile of ["Preferences", "Secure Preferences"]) {
            try {
              const prefs = JSON.parse(
                await fs.readFile(path.join(chromePath, profile, prefsFile), "utf8"),
              );
              const commands: Map<string, any> = prefs.extensions?.commands;

              // If one of the commands is autofill_login or generate_password, we know it's probably the Vowkey extension
              for (const { command_name, extension } of Object.values(commands ?? {})) {
                if (command_name === "autofill_login" || command_name === "generate_password") {
                  ids.add(`chrome-extension://${extension}/`);
                  this.logService.info(`Found extension from ${chromePath}: ${extension}`);
                }
              }

              // Match via settings too. Sometimes global commands don't register properly.
              const settings: Map<string, any> = prefs.extensions?.settings;
              for (const [extension, setting] of Object.entries(settings ?? {})) {
                if (setting.commands) {
                  for (const [command_name] of Object.entries(setting.commands)) {
                    if (command_name === "autofill_login" || command_name === "generate_password") {
                      ids.add(`chrome-extension://${extension}/`);
                      this.logService.info(`Found extension ${chromePath}: ${extension}`);
                    }
                  }
                }
              }
            } catch (e) {
              this.logService.info(`Error reading preferences: ${e}`);
            }
          }
        }
      } catch {
        // Browser is not installed, we can just skip it
      }
    }

    return Array.from(ids);
  }

  private binaryPath() {
    const ext = process.platform === "win32" ? ".exe" : "";

    if (isDev()) {
      const devPath = path.join(
        this.appPath,
        "..",
        "desktop_native",
        "target",
        "debug",
        `desktop_proxy${ext}`,
      );

      // isDev() returns true when using a production build with ELECTRON_IS_DEV=1,
      // so we need to fall back to the prod binary if the dev binary doesn't exist.
      if (existsSync(devPath)) {
        return devPath;
      }
    }

    return path.join(path.dirname(this.exePath), `desktop_proxy${ext}`);
  }

  /**
   * Where the manifests the registry points browsers at are written.
   *
   * The Appx's writes to new AppData folders are redirected into the package, where browsers
   * looking at the original path won't find them. So the Appx writes them into its package folder
   * directly, and registers that path. Its install directory is named for the package full name,
   * `<name>_<version>_<arch>_<resourceId>_<publisherId>`, and its family name is
   * `<name>_<publisherId>`.
   */
  private windowsManifestDirectory() {
    if (!isWindowsStore()) {
      return path.join(this.userPath, "browsers");
    }

    const [, name, publisherId] = process.resourcesPath.match(
      /\\WindowsApps\\([^_\\]+)_[^\\]*_([^_\\]+)\\/,
    );
    return path.join(
      process.env.LOCALAPPDATA,
      "Packages",
      `${name}_${publisherId}`,
      "LocalState",
      "browsers",
    );
  }

  /** The proxy's execution alias, as declared in custom-appx-extensions.*.xml. */
  private appxProxyAliasPath() {
    const alias = process.resourcesPath.includes("8bitSolutionsLLC.VowkeyBeta_")
      ? "vowkey_beta_desktop_proxy.exe"
      : "vowkey_desktop_proxy.exe";
    return path.join(process.env.LOCALAPPDATA, "Microsoft", "WindowsApps", alias);
  }

  private homedir() {
    if (process.platform === "darwin") {
      return userInfo().homedir;
    } else if (process.env.SNAP) {
      // Snap mounts a different user directory, making it impossible to access the unsandboxed paths of native messaging hosts under that dir.
      const username = userInfo().username;
      return path.join("/home", username);
    } else {
      return homedir();
    }
  }

  private async removeIfExists(path: string) {
    if (existsSync(path)) {
      await fs.unlink(path);
    }
  }

  private async linkOrCopy(source: string, destination: string) {
    try {
      if (existsSync(destination)) {
        await fs.unlink(destination);
      }
      await fs.link(source, destination);
      this.logService.info(`[Native messaging] Hard-linked ${source} to ${destination}`);
    } catch (e) {
      this.logService.warning(
        `[Native messaging] Failed to hard-link ${source} to ${destination}, copying instead: ${e}`,
      );
      await fs.copyFile(source, destination);
      this.logService.info(`[Native messaging] Copied ${source} to ${destination}`);
    }
  }
}

/** The client announcement carried by a `Connected` event, or `undefined` if it has none. */
function parseAnnouncement(message: string | null | undefined): IpcClientTypeMessage | undefined {
  if (message == null) {
    return undefined;
  }

  try {
    const json: unknown = JSON.parse(message);
    return isIpcClientTypeMessage(json) ? json : undefined;
  } catch {
    return undefined;
  }
}
