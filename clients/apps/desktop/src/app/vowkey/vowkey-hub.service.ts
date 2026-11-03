import { Injectable } from "@angular/core";
import { Subject } from "rxjs";

import { CipherType } from "@vowkey/common/vault/enums";

export type HubOpenMode = "auto" | "document" | "fill";
export type HubPickMode = "document" | "fill";
export type HubSettingsTab = "general" | "appearance" | "security" | "integrations" | "reading";
export type HubVaultCommand =
  | { kind: "newItem"; cipherType: CipherType }
  | { kind: "focusSearch" }
  | { kind: "openImport" }
  | { kind: "openExport" };

/** Lets the vault page ask the document/form sheet to open and observe local vault updates without owning it. */
@Injectable({ providedIn: "root" })
export class VowkeyHub {
  readonly openRequests$ = new Subject<HubOpenMode>();
  readonly pickRequests$ = new Subject<HubPickMode>();
  readonly settingsRequests$ = new Subject<HubSettingsTab | undefined>();
  readonly vaultCommands$ = new Subject<HubVaultCommand>();
  readonly changed$ = new Subject<void>();

  open(mode: HubOpenMode = "auto"): void {
    this.openRequests$.next(mode);
  }

  openFill(): void {
    this.openRequests$.next("fill");
  }

  pickFile(mode: HubPickMode): void {
    this.pickRequests$.next(mode);
  }

  requestOpenSettings(tab?: HubSettingsTab): void {
    this.settingsRequests$.next(tab);
  }

  requestNewItem(cipherType: CipherType): void {
    this.vaultCommands$.next({ kind: "newItem", cipherType });
  }

  requestFocusSearch(): void {
    this.vaultCommands$.next({ kind: "focusSearch" });
  }

  requestOpenImport(): void {
    this.vaultCommands$.next({ kind: "openImport" });
  }

  requestOpenExport(): void {
    this.vaultCommands$.next({ kind: "openExport" });
  }

  notifyChanged(): void {
    this.changed$.next();
  }
}
