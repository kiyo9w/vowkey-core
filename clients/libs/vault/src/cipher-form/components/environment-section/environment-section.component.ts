import { CommonModule } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  input,
  OnInit,
  signal,
} from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { AbstractControl, FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from "@angular/forms";
import { firstValueFrom } from "rxjs";

import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { CipherService } from "@vowkey/common/vault/abstractions/cipher.service";
import { CipherType } from "@vowkey/common/vault/enums";
import { LocalVaultService } from "@vowkey/common/vault/local/local-vault.service";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import { EnvironmentMember, EnvironmentView } from "@vowkey/common/vault/models/view/environment.view";
import {
  ButtonModule,
  CardComponent,
  FormFieldModule,
  IconButtonModule,
  SectionHeaderComponent,
  SelectModule,
  TypographyModule,
} from "@vowkey/components";
import { I18nPipe } from "@vowkey/ui-common";

import { CipherFormContainer } from "../../cipher-form-container";

/** A variable name is empty or contains `=` or NUL. */
export function invalidVariableName(name: string): boolean {
  return name.length === 0 || name.includes("=") || name.includes("\0");
}

function variableNameValidator(control: AbstractControl) {
  const name = ((control.value as string) ?? "").trim();
  if (name.length === 0) {
    return null;
  }
  return invalidVariableName(name) ? { variableName: true } : null;
}


@Component({
  selector: "vault-environment-section",
  templateUrl: "./environment-section.component.html",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
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
export class EnvironmentSectionComponent implements OnInit {
  readonly originalCipherView = input<CipherView | null>(null);
  readonly disabled = input(false);

  readonly environmentForm = this.formBuilder.group({
    members: this.formBuilder.array<FormGroup>([]),
  });

  /** Visible API keys the person can link a variable to. */
  readonly keyOptions = signal<{ id: string; name: string }[]>([]);

  private readonly destroyRef = inject(DestroyRef);
  private readonly cipherService = inject(CipherService);
  private readonly accountService = inject(AccountService);
  private readonly localVault = inject(LocalVaultService, { optional: true });

  constructor(
    private readonly cipherFormContainer: CipherFormContainer,
    private readonly formBuilder: FormBuilder,
  ) {
    this.cipherFormContainer.registerChildForm("environmentDetails", this.environmentForm);
    this.environmentForm.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => {
      const data = new EnvironmentView();
      data.members = (value.members ?? [])
        .map((member) => ({
          name: (member.name ?? "").trim(),
          itemId: member.itemId ?? "",
        }))
        .filter((member) => member.name.length > 0 || member.itemId.length > 0);
      this.cipherFormContainer.patchCipher((cipher) => {
        cipher.environment = data;
        return cipher;
      });
    });
  }

  get members(): FormArray<FormGroup> {
    return this.environmentForm.controls.members;
  }

  ngOnInit() {
    void this.loadKeys();

    const prefillCipher = this.cipherFormContainer.getInitialCipherView();
    const environmentView = prefillCipher?.environment ?? this.originalCipherView()?.environment;
    const members = environmentView?.members ?? [];

    if (members.length > 0) {
      members.forEach((member) => this.addMember(member, false));
    } else {
      this.addMember(undefined, false);
    }

    if (this.disabled()) {
      this.environmentForm.disable();
    }

    this.cipherFormContainer.formStatusChange$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((status) => {
        if (status === "disabled" || this.disabled()) {
          this.environmentForm.disable();
        } else {
          this.environmentForm.enable();
        }
      });
  }

  addMember(member?: EnvironmentMember, emit = true) {
    this.members.push(
      this.formBuilder.group({
        name: [member?.name ?? "", [Validators.required, variableNameValidator]],
        itemId: [member?.itemId ?? "", Validators.required],
      }),
      { emitEvent: emit },
    );
  }

  removeMember(index: number) {
    this.members.removeAt(index);
  }

  private async loadKeys() {
    const account = await firstValueFrom(this.accountService.activeAccount$);
    const ciphers = account == null
      ? await this.localVault?.list() ?? []
      : [...await firstValueFrom(this.cipherService.cipherViews$(account.id)),
        ...await this.localVault?.pendingItems(account.id) ?? []];
    this.keyOptions.set(
      ciphers
        .filter((cipher) => cipher.type === CipherType.ApiKey && !cipher.isDeleted && cipher.id)
        .map((cipher) => ({ id: cipher.id!, name: cipher.name || cipher.id! })),
    );
  }
}
