import { ChangeDetectionStrategy, Component, DestroyRef, inject, input, OnInit } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";

import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { ApiKeySendStyle, ApiKeyView } from "@vowkey/common/vault/models/view/api-key.view";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import {
  CardComponent,
  FormFieldModule,
  IconButtonModule,
  SectionHeaderComponent,
  SelectModule,
  TypographyModule,
} from "@vowkey/components";
import { I18nPipe } from "@vowkey/ui-common";

import { CipherFormContainer } from "../../cipher-form-container";

/** Splits a host list the way the person typed it: one per line, or comma-separated. */
export function parseAllowedHosts(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(/[\n,]/)
    .map((host) => host.trim())
    .filter((host) => host.length > 0);
}

@Component({
  selector: "vault-api-key-section",
  templateUrl: "./api-key-section.component.html",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CardComponent,
    TypographyModule,
    FormFieldModule,
    ReactiveFormsModule,
    SelectModule,
    SectionHeaderComponent,
    IconButtonModule,
    I18nPipe,
  ],
})
export class ApiKeySectionComponent implements OnInit {
  readonly originalCipherView = input<CipherView | null>(null);
  readonly disabled = input(false);

  readonly apiKeyForm = this.formBuilder.group({
    value: ["", Validators.required],
    sendStyle: [ApiKeySendStyle.Bearer as string, Validators.required],
    allowedHosts: [""],
    headerName: [""],
    basicUsername: [""],
  });

  readonly sendStyleOptions: { label: string; value: string }[];

  private readonly destroyRef = inject(DestroyRef);

  constructor(
    private readonly cipherFormContainer: CipherFormContainer,
    private readonly formBuilder: FormBuilder,
    private readonly i18nService: I18nService,
  ) {
    this.sendStyleOptions = [
      { label: this.i18nService.t("sendStyleBearer"), value: ApiKeySendStyle.Bearer },
      { label: this.i18nService.t("sendStyleHeader"), value: ApiKeySendStyle.Header },
      { label: this.i18nService.t("sendStyleBasic"), value: ApiKeySendStyle.Basic },
    ];

    this.cipherFormContainer.registerChildForm("apiKeyDetails", this.apiKeyForm);
    this.apiKeyForm.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => {
      const data = new ApiKeyView();
      data.value = value.value || undefined;
      data.sendStyle = value.sendStyle || ApiKeySendStyle.Bearer;
      data.allowedHosts = parseAllowedHosts(value.allowedHosts);
      // headerName and basicUsername stay empty unless that send style needs them.
      data.headerName =
        data.sendStyle === ApiKeySendStyle.Header ? value.headerName || undefined : undefined;
      data.basicUsername =
        data.sendStyle === ApiKeySendStyle.Basic ? value.basicUsername ?? "" : undefined;
      this.cipherFormContainer.patchCipher((cipher) => {
        cipher.apiKey = data;
        return cipher;
      });
    });
  }

  ngOnInit() {
    const prefillCipher = this.cipherFormContainer.getInitialCipherView();
    const apiKeyView = prefillCipher?.apiKey ?? this.originalCipherView()?.apiKey;

    if (apiKeyView?.value || apiKeyView?.sendStyle || apiKeyView?.allowedHosts?.length) {
      this.setInitialValues(apiKeyView);
    }

    if (this.disabled()) {
      this.apiKeyForm.disable();
    }

    this.cipherFormContainer.formStatusChange$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((status) => {
        if (status === "disabled" || this.disabled()) {
          this.apiKeyForm.disable();
        } else {
          this.apiKeyForm.enable();
        }
      });
  }

  private setInitialValues(apiKeyView: ApiKeyView) {
    this.apiKeyForm.setValue({
      value: apiKeyView.value || "",
      sendStyle: apiKeyView.sendStyle || ApiKeySendStyle.Bearer,
      allowedHosts: apiKeyView.allowedHosts?.join("\n") || "",
      headerName: apiKeyView.headerName || "",
      basicUsername: apiKeyView.basicUsername ?? "",
    });
  }
}

