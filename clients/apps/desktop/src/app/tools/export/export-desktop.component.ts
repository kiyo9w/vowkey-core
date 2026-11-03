import { CommonModule } from "@angular/common";
import { Component, OnInit, inject, signal } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { FormsModule } from "@angular/forms";
import * as papa from "papaparse";

import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { CipherWithIdExport } from "@vowkey/common/models/export";
import { FileDownloadService } from "@vowkey/common/platform/abstractions/file-download/file-download.service";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { CipherType } from "@vowkey/common/vault/enums";
import { LocalVaultService } from "@vowkey/common/vault/local/local-vault.service";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import {
  DialogRef,
  AsyncActionsModule,
  ButtonModule,
  CalloutModule,
  DialogModule,
  ToastService,
} from "@vowkey/components";
import { I18nPipe } from "@vowkey/ui-common";
import { ExportComponent } from "@vowkey/vault-export-ui";

// FIXME(https://bitwarden.atlassian.net/browse/CL-764): Migrate to OnPush
// eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection
@Component({
  templateUrl: "export-desktop.component.html",
  imports: [
    CommonModule,
    FormsModule,
    I18nPipe,
    DialogModule,
    AsyncActionsModule,
    ButtonModule,
    CalloutModule,
    ExportComponent,
  ],
})
export class ExportDesktopComponent implements OnInit {
  private readonly accountService = inject(AccountService);
  private readonly localVault = inject(LocalVaultService, { optional: true });
  private readonly fileDownloadService = inject(FileDownloadService);
  private readonly i18nService = inject(I18nService);
  private readonly toastService = inject(ToastService);

  protected disabled = false;
  protected loading = false;
  protected readonly skippedAttachmentCount = signal(0);

  protected readonly activeAccount = toSignal(this.accountService.activeAccount$, {
    initialValue: null,
  });
  protected readonly guestFormat = signal<"json" | "csv">("json");
  protected readonly guestRequiresPassword = signal(false);
  protected readonly guestPassword = signal("");
  protected readonly guestError = signal<string | null>(null);
  protected readonly guestSubmitting = signal(false);

  constructor(public dialogRef: DialogRef) {}

  async ngOnInit(): Promise<void> {
    if (this.activeAccount() != null || !this.localVault) {
      return;
    }
    try {
      await this.localVault.initialize();
      const meta = await this.localVault.protectionMetadata();
      this.guestRequiresPassword.set(meta?.wrappedUserKey != null);
    } catch {
      this.guestRequiresPassword.set(false);
    }
  }

  protected async submitGuestExport(): Promise<void> {
    if (!this.localVault || this.guestSubmitting()) {
      return;
    }
    this.guestError.set(null);
    if (this.guestRequiresPassword() && !this.guestPassword().trim()) {
      this.guestError.set(this.i18nService.t("vkLocalPasswordRequired"));
      return;
    }
    this.guestSubmitting.set(true);
    try {
      await this.localVault.initialize();
      if (this.guestRequiresPassword()) {
        try {
          await this.localVault.unlock(this.guestPassword());
        } catch {
          this.guestError.set(this.i18nService.t("invalidMasterPassword"));
          return;
        }
      } else {
        await this.localVault.ensureUnlocked();
      }
      const ciphers = (await this.localVault.list()).filter((c) => c.deletedDate == null);
      const format = this.guestFormat();
      const stamp = new Date()
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d+Z$/, "")
        .replace("T", "");
      const fileName = `vowkey_export_${stamp}.${format}`;
      const blobData = format === "csv" ? this.buildGuestCsv(ciphers) : this.buildGuestJson(ciphers);
      this.fileDownloadService.download({
        fileName,
        blobData,
        blobOptions: { type: "text/plain" },
      });
      this.toastService.showToast({
        variant: "success",
        title: "",
        message: this.i18nService.t("exportSuccess"),
      });
      await this.dialogRef.close();
    } catch (error) {
      this.guestError.set(
        error instanceof Error ? error.message : this.i18nService.t("unexpectedError"),
      );
    } finally {
      this.guestSubmitting.set(false);
    }
  }

  private buildGuestJson(ciphers: CipherView[]): string {
    const items = ciphers.map((c) => {
      const exported = new CipherWithIdExport();
      exported.build(c);
      exported.collectionIds = null;
      delete (exported as { key?: unknown }).key;
      return exported;
    });
    return JSON.stringify({ encrypted: false, folders: [], items }, null, "  ");
  }

  private buildGuestCsv(ciphers: CipherView[]): string {
    const rows = ciphers
      .filter((c) => c.type === CipherType.Login || c.type === CipherType.SecureNote)
      .map((c) => ({
        folder: null as string | null,
        favorite: c.favorite ? 1 : null,
        type: c.type === CipherType.Login ? "login" : "note",
        name: c.name,
        notes: c.notes,
        fields: c.fields?.length
          ? c.fields.map((f) => `${f.name || ""}: ${f.value ?? ""}`).join("\n")
          : null,
        reprompt: c.reprompt,
        archivedDate: c.archivedDate ? c.archivedDate.toISOString() : null,
        login_uri: c.login?.uris?.length ? c.login.uris.map((u) => u.uri) : null,
        login_username: c.login?.username ?? null,
        login_password: c.login?.password ?? null,
        login_totp: c.login?.totp ?? null,
      }));
    return papa.unparse(rows);
  }

  /**
   * Callback that is called after a successful export.
   */
  protected async onSuccessfulExport(organizationId: string): Promise<void> {
    // Skip closing dialog when attachments were skipped so the user can see the warning callout
    if (this.skippedAttachmentCount() > 0) {
      return;
    }
    await this.dialogRef.close();
  }
}
