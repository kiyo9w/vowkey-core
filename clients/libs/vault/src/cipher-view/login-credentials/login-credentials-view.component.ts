// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { CommonModule, DatePipe } from "@angular/common";
import {
  Component,
  ElementRef,
  EventEmitter,
  inject,
  input,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild,
} from "@angular/core";
import { toObservable } from "@angular/core/rxjs-interop";
import { Observable, of } from "rxjs";

import { JslibModule } from "@vowkey/angular/jslib.module";
import { BillingAccountProfileStateService } from "@vowkey/common/billing/abstractions";
import { EventCollectionService, EventType } from "@vowkey/common/dirt/event-logs";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { UserId } from "@vowkey/common/types/guid";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import {
  formatSocialSignInSummary,
  parseSocialSignIn,
  SocialSignInInfo,
} from "@vowkey/common/vault/social-sign-in";
import {
  FormFieldModule,
  SectionHeaderComponent,
  TypographyModule,
  LinkModule,
  IconButtonModule,
  ColorPasswordModule,
} from "@vowkey/components";

import { BitTotpCountdownComponent } from "../../components/totp-countdown/totp-countdown.component";
import { ReadOnlyCipherCardComponent } from "../read-only-cipher-card/read-only-cipher-card.component";

type TotpCodeValues = {
  totpCode: string;
  totpCodeFormatted?: string;
};

// FIXME(https://bitwarden.atlassian.net/browse/CL-764): Migrate to OnPush
// eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection
@Component({
  selector: "app-login-credentials-view",
  templateUrl: "login-credentials-view.component.html",
  imports: [
    CommonModule,
    JslibModule,
    SectionHeaderComponent,
    TypographyModule,
    FormFieldModule,
    IconButtonModule,
    ColorPasswordModule,
    BitTotpCountdownComponent,
    ReadOnlyCipherCardComponent,
    LinkModule,
  ],
})
export class LoginCredentialsViewComponent implements OnChanges {
  // FIXME(https://bitwarden.atlassian.net/browse/CL-903): Migrate to Signals
  // eslint-disable-next-line @angular-eslint/prefer-signals
  @Input() cipher: CipherView;
  protected readonly activeUserId = input<UserId | null>(null);
  // FIXME(https://bitwarden.atlassian.net/browse/CL-903): Migrate to Signals
  // eslint-disable-next-line @angular-eslint/prefer-signals
  @Input() showChangePasswordLink: boolean;
  readonly changePasswordLink = input<string | undefined>();
  // FIXME(https://bitwarden.atlassian.net/browse/CL-903): Migrate to Signals
  // eslint-disable-next-line @angular-eslint/prefer-output-emitter-ref
  @Output() handleChangePassword = new EventEmitter<void>();
  // FIXME(https://bitwarden.atlassian.net/browse/CL-903): Migrate to Signals
  // eslint-disable-next-line @angular-eslint/prefer-signals
  @ViewChild("passwordInput")
  private passwordInput!: ElementRef<HTMLInputElement>;
  /**
   * Optional input for manually specifying whether the user can be considered
   * premium in anonymous environments where the userId is not available
   */
  readonly hasAnonymousPremium = input<boolean>(false);
  readonly hasAnonymousPremium$ = toObservable(this.hasAnonymousPremium);

  readonly activeUserId$ = toObservable(this.activeUserId);

  isPremium$: Observable<boolean> = of(true);
  showPasswordCount: boolean = false;
  passwordRevealed: boolean = false;
  totpCodeCopyObj: TotpCodeValues;

  private datePipe = inject(DatePipe);

  constructor(
    private billingAccountProfileStateService: BillingAccountProfileStateService,
    private i18nService: I18nService,
    private eventCollectionService: EventCollectionService,
  ) {}

  get socialSignIn(): SocialSignInInfo | null {
    return parseSocialSignIn(this.cipher);
  }

  get socialSignInDisplay(): string {
    const info = this.socialSignIn;
    if (!info) {
      return "";
    }
    return formatSocialSignInSummary(info, (key, p1) => this.i18nService.t(key, p1));
  }

  tOr(key: string, fallback: string): string {
    const val = this.i18nService.t(key);
    return val && val !== key ? val : fallback;
  }

  get fido2CredentialCreationDateValue(): string {
    const cred = this.cipher.login.fido2Credentials?.[0];
    const dateCreated = this.i18nService.t("dateCreated");
    const creationDate = cred?.creationDate
      ? this.datePipe.transform(cred.creationDate, "short")
      : null;
    const identity = cred?.userName || cred?.userDisplayName || "";
    const rp = cred?.rpId || cred?.rpName || "";
    const parts: string[] = [];
    if (identity) {
      parts.push(identity);
    }
    if (rp && rp !== identity) {
      parts.push(rp);
    }
    if (creationDate) {
      parts.push(`${dateCreated} ${creationDate}`);
    } else if (parts.length === 0) {
      parts.push(`${dateCreated} `);
    }
    return parts.join(" · ");
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["cipher"]) {
      if (this.passwordInput?.nativeElement) {
        // Reset password input type in case it's been toggled
        this.passwordInput.nativeElement.type = "password";
      }
      this.passwordRevealed = false;
      this.showPasswordCount = false;
    }
  }

  async pwToggleValue(passwordVisible: boolean) {
    this.passwordRevealed = passwordVisible;

    if (passwordVisible) {
      await this.eventCollectionService.collect(
        EventType.Cipher_ClientToggledPasswordVisible,
        this.cipher.id,
        false,
        this.cipher.organizationId,
      );
    }
  }

  togglePasswordCount() {
    this.showPasswordCount = !this.showPasswordCount;
  }

  setTotpCopyCode(e: TotpCodeValues) {
    this.totpCodeCopyObj = e;
  }

  async logCopyEvent() {
    await this.eventCollectionService.collect(
      EventType.Cipher_ClientCopiedPassword,
      this.cipher.id,
      false,
      this.cipher.organizationId,
    );
  }

  launchChangePasswordEvent(): void {
    this.handleChangePassword.emit();
  }
}
