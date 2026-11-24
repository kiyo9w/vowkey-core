import { Injectable, signal } from "@angular/core";
import { Subject } from "rxjs";

import { CipherType } from "@vowkey/common/vault/enums";

export type HubOpenMode = "auto" | "document" | "fill";
export type HubOpenRequest = HubOpenMode | { mode: HubOpenMode; profileId?: string };
export type HubPickMode = "document" | "fill";
export type HubPickRequest = HubPickMode | { mode: HubPickMode; profileId?: string };
export type HubSettingsTab = "general" | "appearance" | "security" | "integrations" | "reading";
export type HubVaultCommand =
  | { kind: "newItem"; cipherType: CipherType; profileId?: string }
  | { kind: "focusSearch" }
  | { kind: "openImport" }
  | { kind: "openExport" };

/** Lets the vault page ask the document/form sheet to open and observe local vault updates without owning it. */
@Injectable({ providedIn: "root" })
export class VowkeyHub {
  readonly openRequests$ = new Subject<HubOpenRequest>();
  readonly pickRequests$ = new Subject<HubPickRequest>();
  readonly settingsRequests$ = new Subject<HubSettingsTab | undefined>();
  readonly vaultCommands$ = new Subject<HubVaultCommand>();
  readonly changed$ = new Subject<void>();
  readonly sidebarCollapsed = signal(false);

  toggleSidebar(): void {
    this.sidebarCollapsed.update((collapsed) => !collapsed);
  }

  open(mode: HubOpenMode = "auto", profileId?: string): void {
    this.openRequests$.next(profileId ? { mode, profileId } : mode);
  }

  openFill(): void {
    this.openRequests$.next("fill");
  }

  pickFile(mode: HubPickMode, profileId?: string): void {
    this.pickRequests$.next(profileId ? { mode, profileId } : mode);
  }

  requestOpenSettings(tab?: HubSettingsTab): void {
    this.settingsRequests$.next(tab);
  }

  requestNewItem(cipherType: CipherType, profileId?: string): void {
    this.vaultCommands$.next({ kind: "newItem", cipherType, profileId });
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
