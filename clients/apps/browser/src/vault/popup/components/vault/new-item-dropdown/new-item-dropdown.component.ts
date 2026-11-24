// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { CommonModule } from "@angular/common";
import { Component, Input, OnInit, Optional, input } from "@angular/core";
import { toObservable, toSignal } from "@angular/core/rxjs-interop";
import { Router, RouterLink } from "@angular/router";
import { combineLatest, map, Observable } from "rxjs";

import { JslibModule } from "@vowkey/angular/jslib.module";
import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { FeatureFlag } from "@vowkey/common/enums/feature-flag.enum";
import { ConfigService } from "@vowkey/common/platform/abstractions/config/config.service";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { CollectionId, OrganizationId } from "@vowkey/common/types/guid";
import { CipherService } from "@vowkey/common/vault/abstractions/cipher.service";
import { CipherType } from "@vowkey/common/vault/enums";
import { LocalVaultService } from "@vowkey/common/vault/local/local-vault.service";
import { DocumentCaptureError, ProductInference } from "@vowkey/common/vault/local/product-inference";
import { RestrictedItemTypesService } from "@vowkey/common/vault/services/restricted-item-types.service";
import { CipherMenuItem, CIPHER_MENU_ITEMS } from "@vowkey/common/vault/types/cipher-menu-items";
import {
  ButtonModule,
  DialogService,
  MenuModule,
  ToastService,
  TooltipDirective,
} from "@vowkey/components";
import { AddEditFolderDialogComponent } from "@vowkey/vault";

import { BrowserApi } from "../../../../../platform/browser/browser-api";
import BrowserPopupUtils from "../../../../../platform/browser/browser-popup-utils";
import { captureAndSaveBrowserDocument } from "../../../services/browser-document-capture";
import { AddEditQueryParams } from "../add-edit/add-edit.component";

export interface NewItemInitialValues {
  folderId?: string;
  organizationId?: OrganizationId;
  collectionId?: CollectionId;
}

// FIXME(https://bitwarden.atlassian.net/browse/CL-764): Migrate to OnPush
// eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection
@Component({
  selector: "app-new-item-dropdown",
  templateUrl: "new-item-dropdown.component.html",
  imports: [JslibModule, CommonModule, ButtonModule, RouterLink, MenuModule, TooltipDirective],
})
export class NewItemDropdownComponent implements OnInit {
  cipherType = CipherType;
  private tab?: chrome.tabs.Tab;
  /**
   * Optional initial values to pass to the add cipher form
   */
  // FIXME(https://bitwarden.atlassian.net/browse/CL-903): Migrate to Signals
  // eslint-disable-next-line @angular-eslint/prefer-signals
  @Input()
  initialValues: NewItemInitialValues;

  /**
   * Whether a cipher can be created for the current organization context.
   * `false` when the target organization is suspended, since items cannot be saved to it.
   */
  readonly canCreateCipher = input(true);

  /**
   * Observable of cipher menu items that are not restricted by policy
   */
  readonly cipherMenuItems$: Observable<CipherMenuItem[]> = combineLatest([
    this.restrictedItemTypeService.restricted$,
    toObservable(this.canCreateCipher),
  ]).pipe(
    map(([restrictedTypes, canCreateCipher]) => {
      if (!canCreateCipher) {
        return [];
      }

      const restrictedTypeArr = restrictedTypes.map((item) => item.cipherType);

      return CIPHER_MENU_ITEMS.filter(
        (menuItem) =>
          menuItem.type === CipherType.Identity && !restrictedTypeArr.includes(menuItem.type),
      );
    }),
  );

  readonly useNewItemDialog = () => false;

  constructor(
    private dialogService: DialogService,
    private restrictedItemTypeService: RestrictedItemTypesService,
    private configService: ConfigService,
    private router: Router,
    @Optional() private cipherService?: CipherService,
    @Optional() private accountService?: AccountService,
    @Optional() private localVaultService?: LocalVaultService,
    @Optional() private productInference?: ProductInference,
    @Optional() private toastService?: ToastService,
    @Optional() private i18nService?: I18nService,
  ) {}

  async ngOnInit() {
    this.tab = await BrowserApi.getTabFromCurrentWindow();
  }

  buildQueryParams(type: CipherType): AddEditQueryParams {
    const poppedOut = BrowserPopupUtils.inPopout(window);

    const loginDetails: { prefillNameAndURIFromTab?: string } = {};

    // When a Login Cipher is created and the extension is not popped out,
    // pass along the uri and name
    if (!poppedOut && type === CipherType.Login && this.tab) {
      loginDetails.prefillNameAndURIFromTab = "true";
    }

    return {
      type: type.toString(),
      collectionIds: this.initialValues?.collectionId,
      organizationId: this.initialValues?.organizationId,
      folderId: this.initialValues?.folderId,
      ...loginDetails,
    };
  }

  openFolderDialog() {
    AddEditFolderDialogComponent.open(this.dialogService);
  }

  async openAddDocument(inputEl: HTMLInputElement) {
    if (
      typeof window !== "undefined" &&
      BrowserPopupUtils.inPopup(window) &&
      !BrowserPopupUtils.inPopout(window) &&
      !BrowserPopupUtils.inSidebar(window) &&
      typeof chrome !== "undefined" &&
      chrome.windows
    ) {
      await BrowserPopupUtils.openPopout("popup/index.html#/tabs/vault?action=add-document");
      return;
    }
    inputEl.click();
  }

  async onDocumentSelected(event: Event) {
    const inputEl = event.target as HTMLInputElement;
    const file = inputEl.files?.[0];
    inputEl.value = "";
    if (!file) {
      return;
    }
    try {
      const saved = await captureAndSaveBrowserDocument(file, {
        cipherService: this.cipherService,
        accountService: this.accountService,
        localVaultService: this.localVaultService,
        productInference: this.productInference,
      });
      await this.router.navigate(["/view-cipher"], {
        queryParams: { cipherId: saved.cipher.id, type: CipherType.Identity },
      });
    } catch (error) {
      const msg = this.i18nService?.t(
        error instanceof DocumentCaptureError ? error.i18nKey : "unexpectedError",
      ) ?? "Could not read this document.";
      this.toastService?.showToast({
        variant: "error",
        title: null,
        message: msg,
      });
    }
  }

  navigateToNewItemPage(): void {
    void this.router.navigate(["/new-item"], {
      queryParams: {
        folderId: this.initialValues?.folderId,
        organizationId: this.initialValues?.organizationId,
        collectionIds: this.initialValues?.collectionId,
      },
    });
  }
}
