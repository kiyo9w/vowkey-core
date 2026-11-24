import { existsSync } from "fs";
import * as fs from "fs/promises";
import * as path from "path";

import { BrowserWindow, dialog } from "electron";

import {
  DecisionCatalogModel,
  DecisionCustomModel,
  DecisionModelsState,
  DecisionPreparationState,
} from "../types/capture";

import {
  CatalogModelSpec,
  DECISION_MODEL_CATALOG,
  DEFAULT_DECISION_MODEL_ID,
  findCachedCatalogModel,
  hasVerifiedReceiptSync,
  huggingFaceCacheRoots,
  materializeCatalogModels,
  materializeCustomModels,
  modelFilePath,
  resolveModelDownloadUrl,
  StoredDecisionModelEntry,
  StoredDecisionModelsConfig,
  validateGgufFile,
  writeVerificationReceipt,
} from "./decision-models";
import {
  DecisionServerSupervisor,
  ensureDecisionRuntimeBinary,
  locateInstalledRuntimeBinary,
  runtimeArchiveForPlatform,
  streamVerifiedDownload,
} from "./decision-runtime";

const MODELS_CONFIG_FILENAME = "vowkey-decision-models.json";

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && (err.name === "AbortError" || /aborted/i.test(err.message)))
  );
}

export class DecisionModelManager {
  private readonly supervisor = new DecisionServerSupervisor();
  private abortController: AbortController | null = null;
  private preparation: DecisionPreparationState | null = null;
  private loaded = false;
  private selectedModelId = DEFAULT_DECISION_MODEL_ID;
  private activeModelId: string | null = null;
  private customEntries: StoredDecisionModelEntry[] = [];
  private readonly listeners = new Set<(state: DecisionModelsState) => void>();

  constructor(
    private readonly getUserDataDir: () => string,
    private readonly getCacheRoots: () => readonly string[] = huggingFaceCacheRoots,
  ) {}

  private modelsDir(): string {
    return path.join(this.getUserDataDir(), "decision-models");
  }

  private configPath(): string {
    return path.join(this.getUserDataDir(), MODELS_CONFIG_FILENAME);
  }

  private async ensureConfigLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    try {
      const file = this.configPath();
      if (!existsSync(file)) {
        return;
      }
      const raw = JSON.parse(await fs.readFile(file, "utf8")) as StoredDecisionModelsConfig;
      if (typeof raw?.selectedModelId === "string" && raw.selectedModelId.trim()) {
        this.selectedModelId = raw.selectedModelId.trim();
      }
      if (raw?.activeModelId === null || typeof raw?.activeModelId === "string") {
        this.activeModelId = raw.activeModelId?.trim() || null;
      }
      if (Array.isArray(raw?.customModels)) {
        this.customEntries = raw.customModels.filter(
          (item): item is StoredDecisionModelEntry =>
            typeof item?.id === "string" &&
            typeof item?.name === "string" &&
            typeof item?.filePath === "string",
        );
      }
    } catch {
      // Corrupt or unreadable state starts clean with defaults.
    }
  }

  private async saveConfig(): Promise<void> {
    const file = this.configPath();
    await fs.mkdir(path.dirname(file), { recursive: true });
    const data: StoredDecisionModelsConfig = {
      selectedModelId: this.selectedModelId,
      activeModelId: this.activeModelId,
      customModels: this.customEntries,
    };
    await fs.writeFile(file, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
  }

  onChange(listener: (state: DecisionModelsState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(state: DecisionModelsState): void {
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch {
        // Listener errors never break model operations.
      }
    }
    try {
      for (const win of BrowserWindow.getAllWindows?.() ?? []) {
        if (!win.isDestroyed()) {
          win.webContents.send("capture.decisionModelsState", state);
        }
      }
    } catch {
      // Safe outside an active Electron BrowserWindow session.
    }
  }

  private findCatalogSpec(modelId: string): CatalogModelSpec | undefined {
    return DECISION_MODEL_CATALOG.find((item) => item.id === modelId);
  }

  private resolveAvailableModelPath(
    modelId: string,
  ): { filePath: string; perRequest: number } | null {
    const spec = this.findCatalogSpec(modelId);
    if (spec) {
      const managedPath = modelFilePath(this.modelsDir(), spec);
      if (hasVerifiedReceiptSync(managedPath, spec.bytes, spec.sha256)) {
        return { filePath: managedPath, perRequest: spec.perRequest };
      }
      const found = findCachedCatalogModel(spec, this.getCacheRoots());
      if (found) {
        return { filePath: found, perRequest: spec.perRequest };
      }
      return null;
    }
    const custom = this.customEntries.find((entry) => entry.id === modelId);
    if (custom && existsSync(custom.filePath)) {
      return { filePath: custom.filePath, perRequest: 20 };
    }
    return null;
  }

  async getState(): Promise<DecisionModelsState> {
    await this.ensureConfigLoaded();
    const catalog: DecisionCatalogModel[] = materializeCatalogModels(
      this.modelsDir(),
      this.getCacheRoots(),
    );
    const customModels: DecisionCustomModel[] = materializeCustomModels(this.customEntries);

    const validIds = new Set<string>([
      ...catalog.map((m) => m.id),
      ...customModels.map((m) => m.id),
    ]);
    if (!validIds.has(this.selectedModelId)) {
      this.selectedModelId = DEFAULT_DECISION_MODEL_ID;
    }
    if (this.activeModelId && !this.resolveAvailableModelPath(this.activeModelId)) {
      this.activeModelId = null;
      await this.supervisor.stop();
      await this.saveConfig();
    }

    const activeResolved = this.activeModelId
      ? this.resolveAvailableModelPath(this.activeModelId)
      : null;

    return {
      selectedModelId: this.selectedModelId,
      activeModelId: this.activeModelId,
      serverReady: Boolean(activeResolved && this.supervisor.isReadyFor(activeResolved.filePath)),
      preparation: this.preparation ? { ...this.preparation } : null,
      catalog,
      customModels,
    };
  }

  async chooseModel(modelId: string): Promise<DecisionModelsState> {
    await this.ensureConfigLoaded();
    const trimmed = modelId.trim();
    if (!trimmed) {
      return this.getState();
    }
    this.selectedModelId = trimmed;
    const available = this.resolveAvailableModelPath(trimmed);
    if (!available) {
      await this.saveConfig();
      const state = await this.getState();
      this.emit(state);
      return state;
    }
    return this.activateInstalledModel(trimmed, available.filePath);
  }

  async downloadModel(modelId?: string): Promise<DecisionModelsState> {
    await this.ensureConfigLoaded();
    const targetId = (modelId?.trim() || this.selectedModelId).trim();
    const spec = this.findCatalogSpec(targetId);
    if (!spec) {
      const available = this.resolveAvailableModelPath(targetId);
      if (available) {
        return this.activateInstalledModel(targetId, available.filePath);
      }
      throw new Error("Unknown decision model.");
    }

    this.cancelInFlight();
    this.selectedModelId = spec.id;
    await this.saveConfig();

    const existing = this.resolveAvailableModelPath(spec.id);
    if (existing) {
      return this.activateInstalledModel(spec.id, existing.filePath);
    }

    const controller = new AbortController();
    this.abortController = controller;

    const userDataDir = this.getUserDataDir();
    const runtimeNeedsDownload = locateInstalledRuntimeBinary(userDataDir) == null;
    const runtimeBytes = runtimeNeedsDownload ? (runtimeArchiveForPlatform()?.bytes ?? 0) : 0;
    const totalBytes = runtimeBytes + spec.bytes;

    this.preparation = {
      modelId: spec.id,
      phase: "downloading",
      downloadedBytes: 0,
      totalBytes,
    };
    this.emit(await this.getState());

    try {
      const binaryPath = await ensureDecisionRuntimeBinary({
        userDataDir,
        signal: controller.signal,
        onProgress: (done) => {
          if (this.abortController === controller) {
            this.preparation = {
              modelId: spec.id,
              phase: "downloading",
              downloadedBytes: Math.min(done, totalBytes),
              totalBytes,
            };
            void this.getState().then((s) => this.emit(s));
          }
        },
      });

      const destPath = modelFilePath(this.modelsDir(), spec);
      await streamVerifiedDownload({
        url: resolveModelDownloadUrl(spec),
        destinationPath: destPath,
        expectedBytes: spec.bytes,
        expectedSha256: spec.sha256,
        signal: controller.signal,
        onProgress: (done) => {
          if (this.abortController === controller) {
            this.preparation = {
              modelId: spec.id,
              phase: "downloading",
              downloadedBytes: Math.min(runtimeBytes + done, totalBytes),
              totalBytes,
            };
            void this.getState().then((s) => this.emit(s));
          }
        },
      });

      this.preparation = {
        modelId: spec.id,
        phase: "verifying",
        downloadedBytes: totalBytes,
        totalBytes,
      };
      this.emit(await this.getState());
      await writeVerificationReceipt(destPath, spec.sha256);

      this.preparation = {
        modelId: spec.id,
        phase: "loading",
        downloadedBytes: totalBytes,
        totalBytes,
      };
      this.emit(await this.getState());

      await this.supervisor.ensureRunning(binaryPath, destPath, controller.signal);
      this.activeModelId = spec.id;
      this.preparation = null;
      await this.saveConfig();
      const readyState = await this.getState();
      this.emit(readyState);
      return readyState;
    } catch (err) {
      if (isAbortError(err)) {
        if (this.abortController === controller) {
          this.preparation = null;
        }
        const cancelledState = await this.getState();
        this.emit(cancelledState);
        return cancelledState;
      }
      const message = err instanceof Error ? err.message : String(err);
      if (this.abortController === controller) {
        this.preparation = {
          modelId: spec.id,
          phase: "downloading",
          downloadedBytes: 0,
          totalBytes: spec.bytes,
          error: message,
        };
      }
      const errorState = await this.getState();
      this.emit(errorState);
      return errorState;
    } finally {
      if (this.abortController === controller) {
        this.abortController = null;
      }
    }
  }

  private async activateInstalledModel(
    modelId: string,
    filePath: string,
  ): Promise<DecisionModelsState> {
    this.cancelInFlight();
    const controller = new AbortController();
    this.abortController = controller;
    const userDataDir = this.getUserDataDir();
    const runtimeNeedsDownload = locateInstalledRuntimeBinary(userDataDir) == null;
    const runtimeBytes = runtimeNeedsDownload ? (runtimeArchiveForPlatform()?.bytes ?? 0) : 0;

    this.preparation = {
      modelId,
      phase: runtimeNeedsDownload ? "downloading" : "loading",
      downloadedBytes: 0,
      totalBytes: runtimeBytes,
    };
    this.emit(await this.getState());

    try {
      const binaryPath = await ensureDecisionRuntimeBinary({
        userDataDir,
        signal: controller.signal,
        onProgress: (done, total) => {
          if (this.abortController === controller) {
            this.preparation = {
              modelId,
              phase: "downloading",
              downloadedBytes: done,
              totalBytes: total,
            };
            void this.getState().then((s) => this.emit(s));
          }
        },
      });
      this.preparation = {
        modelId,
        phase: "loading",
        downloadedBytes: runtimeBytes,
        totalBytes: runtimeBytes,
      };
      this.emit(await this.getState());
      await this.supervisor.ensureRunning(binaryPath, filePath, controller.signal);
      this.selectedModelId = modelId;
      this.activeModelId = modelId;
      this.preparation = null;
      await this.saveConfig();
      const state = await this.getState();
      this.emit(state);
      return state;
    } catch (err) {
      if (isAbortError(err)) {
        if (this.abortController === controller) {
          this.preparation = null;
        }
        const state = await this.getState();
        this.emit(state);
        return state;
      }
      const message = err instanceof Error ? err.message : String(err);
      if (this.abortController === controller) {
        this.preparation = {
          modelId,
          phase: "loading",
          downloadedBytes: 0,
          totalBytes: 0,
          error: message,
        };
      }
      const state = await this.getState();
      this.emit(state);
      return state;
    } finally {
      if (this.abortController === controller) {
        this.abortController = null;
      }
    }
  }

  private cancelInFlight(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.preparation = null;
  }

  async cancelDownload(): Promise<DecisionModelsState> {
    await this.ensureConfigLoaded();
    this.cancelInFlight();
    const state = await this.getState();
    this.emit(state);
    return state;
  }

  async setLocalActive(active: boolean): Promise<DecisionModelsState> {
    await this.ensureConfigLoaded();
    if (!active) {
      if (this.activeModelId != null) {
        this.activeModelId = null;
        await this.supervisor.stop();
        await this.saveConfig();
      }
      const state = await this.getState();
      this.emit(state);
      return state;
    }
    const targetId = this.activeModelId || this.selectedModelId;
    const available = this.resolveAvailableModelPath(targetId);
    if (available) {
      return this.activateInstalledModel(targetId, available.filePath);
    }
    const state = await this.getState();
    this.emit(state);
    return state;
  }

  async deleteModel(modelId: string): Promise<DecisionModelsState> {
    await this.ensureConfigLoaded();
    const trimmed = modelId.trim();
    if (!trimmed || trimmed === this.activeModelId) {
      return this.getState();
    }
    if (this.preparation?.modelId === trimmed && !this.preparation.error) {
      this.cancelInFlight();
    }
    if (this.preparation?.modelId === trimmed) {
      this.preparation = null;
    }
    const spec = this.findCatalogSpec(trimmed);
    if (spec) {
      const folder = path.join(this.modelsDir(), spec.id);
      await fs.rm(folder, { recursive: true, force: true }).catch((): void => undefined);
    } else if (trimmed.startsWith("custom-")) {
      this.customEntries = this.customEntries.filter((entry) => entry.id !== trimmed);
      if (this.selectedModelId === trimmed) {
        this.selectedModelId = this.activeModelId ?? DEFAULT_DECISION_MODEL_ID;
      }
      await this.saveConfig();
    }
    const state = await this.getState();
    this.emit(state);
    return state;
  }

  async importModelFile(explicitFilePath?: string): Promise<DecisionModelsState> {
    await this.ensureConfigLoaded();
    let chosenPath = explicitFilePath?.trim();
    if (!chosenPath) {
      const focused = BrowserWindow.getFocusedWindow?.() ?? undefined;
      const openResult = focused
        ? await dialog.showOpenDialog(focused, {
            properties: ["openFile"],
            filters: [{ name: "GGUF model", extensions: ["gguf"] }],
          })
        : await dialog.showOpenDialog({
            properties: ["openFile"],
            filters: [{ name: "GGUF model", extensions: ["gguf"] }],
          });
      if (openResult.canceled || openResult.filePaths.length === 0) {
        return this.getState();
      }
      chosenPath = openResult.filePaths[0];
    }

    const validated = await validateGgufFile(chosenPath);
    const existingIdx = this.customEntries.findIndex((item) => item.id === validated.id);
    const entry: StoredDecisionModelEntry = {
      id: validated.id,
      name: validated.name,
      filePath: validated.canonicalPath,
    };
    if (existingIdx >= 0) {
      this.customEntries[existingIdx] = entry;
    } else {
      this.customEntries.unshift(entry);
    }
    this.selectedModelId = entry.id;
    await this.saveConfig();
    return this.activateInstalledModel(entry.id, entry.filePath);
  }

  async activeModelSettings(): Promise<{ perRequest: number; local: true } | null> {
    await this.ensureConfigLoaded();
    if (!this.activeModelId) {
      return null;
    }
    const resolved = this.resolveAvailableModelPath(this.activeModelId);
    if (!resolved) {
      this.activeModelId = null;
      await this.saveConfig();
      return null;
    }
    return {
      perRequest: resolved.perRequest,
      local: true,
    };
  }

  async activeEndpoint(): Promise<{ url: string; model: string; perRequest: number } | null> {
    await this.ensureConfigLoaded();
    if (!this.activeModelId) {
      return null;
    }
    const resolved = this.resolveAvailableModelPath(this.activeModelId);
    if (!resolved) {
      this.activeModelId = null;
      await this.saveConfig();
      return null;
    }
    const binaryPath = await ensureDecisionRuntimeBinary({
      userDataDir: this.getUserDataDir(),
    });
    const url = await this.supervisor.ensureRunning(binaryPath, resolved.filePath);
    return {
      url,
      model: this.activeModelId,
      perRequest: resolved.perRequest,
    };
  }

  hasActiveLocalModelSync(): boolean {
    return Boolean(this.activeModelId && this.resolveAvailableModelPath(this.activeModelId));
  }

  async dispose(): Promise<void> {
    this.cancelInFlight();
    await this.supervisor.stop();
  }
}
