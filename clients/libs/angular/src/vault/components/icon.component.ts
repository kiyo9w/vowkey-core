import { CommonModule } from "@angular/common";
import { ChangeDetectionStrategy, Component, computed, input, signal } from "@angular/core";
import { toObservable } from "@angular/core/rxjs-interop";
import {
  combineLatest,
  distinctUntilChanged,
  map,
  tap,
  Observable,
  startWith,
  pairwise,
} from "rxjs";

import { DomainSettingsService } from "@vowkey/common/autofill/services/domain-settings.service";
import { FeatureFlag } from "@vowkey/common/enums/feature-flag.enum";
import { ConfigService } from "@vowkey/common/platform/abstractions/config/config.service";
import { EnvironmentService } from "@vowkey/common/platform/abstractions/environment.service";
import { CipherType } from "@vowkey/common/vault/enums/cipher-type";
import { buildCipherIcon, CipherIconDetails } from "@vowkey/common/vault/icon/build-cipher-icon";
import {
  CipherViewLike,
  CipherViewLikeUtils,
} from "@vowkey/common/vault/utils/cipher-view-like-utils";

interface KindPicto {
  kind: "login" | "card" | "profile" | "document" | "note" | "key" | "environment";
  body: string;
  soft?: string;
  detail?: string;
}

const KIND_PICTOS: Record<KindPicto["kind"], Omit<KindPicto, "kind">> = {
  document: {
    body: "M7 3h6.6L19 8.4V19a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",
    detail: "M13.4 3.4V8h5.2M8.5 12.2h7M8.5 15.2h7M8.5 18h4",
  },
  profile: {
    body: "M12 3.5a4.2 4.2 0 1 1 0 8.4 4.2 4.2 0 0 1 0-8.4zM4.5 20.2c.5-3.7 3.5-6 7.5-6s7 2.3 7.5 6a1 1 0 0 1-1 1.1H5.5a1 1 0 0 1-1-1.1z",
  },
  login: {
    body: "M12 2.8a9.2 9.2 0 1 1 0 18.4 9.2 9.2 0 0 1 0-18.4z",
    detail:
      "M3.2 12h17.6M12 3c2.5 2.5 3.8 5.5 3.8 9S14.5 18.5 12 21c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z",
  },
  card: {
    body: "M5 5h14a2.5 2.5 0 0 1 2.5 2.5v9A2.5 2.5 0 0 1 19 19H5a2.5 2.5 0 0 1-2.5-2.5v-9A2.5 2.5 0 0 1 5 5z",
    detail: "M2.8 9.6h18.4M6.5 15h3.5",
  },
  note: {
    body: "M6.5 3.5h11a2 2 0 0 1 2 2v9.5l-5 5.5h-8a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2z",
    detail: "M8.2 8.5h7.6M8.2 12h5M14.5 20v-4a1 1 0 0 1 1-1h4",
  },
  key: {
    body: "M15.2 3.2a5.8 5.8 0 0 0-5.5 7.7L3.2 17.4V21h3.6v-2.2h2.2v-2.2h2l1.4-1.4a5.8 5.8 0 1 0 2.8-10z",
    detail: "M16.7 7.7h.1",
  },
  environment: {
    body: "M12 2.8l9 4.6-9 4.6-9-4.6z",
    soft: "M3.6 11.8l8.4 4.3 8.4-4.3M3.6 16.2l8.4 4.3 8.4-4.3",
  },
};

function resolveKind(type: CipherType): KindPicto["kind"] {
  switch (type) {
    case CipherType.Identity:
      return "profile";
    case CipherType.Passport:
    case CipherType.DriversLicense:
      return "document";
    case CipherType.Card:
    case CipherType.BankAccount:
      return "card";
    case CipherType.SecureNote:
      return "note";
    case CipherType.SshKey:
    case CipherType.ApiKey:
      return "key";
    case CipherType.Environment:
      return "environment";
    case CipherType.Login:
    default:
      return "login";
  }
}

@Component({
  selector: "app-vault-icon",
  templateUrl: "icon.component.html",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
})
export class IconComponent {
  /**
   * The cipher to display the icon for.
   */
  readonly cipher = input.required<CipherViewLike>();

  /**
   * coloredIcon will adjust the size of favicons and the colors of the text icon when user is in the item details view.
   */
  readonly coloredIcon = input<boolean>(false);

  /**
   * Optional custom size for the icon in pixels.
   * When provided, forces explicit dimensions on the icon wrapper to prevent layout collapse at different zoom levels.
   * If not provided, the wrapper has no explicit dimensions and relies on CSS classes (tw-size-6/24px for images).
   * This can cause the wrapper to collapse when images are loading/hidden, especially at high browser zoom levels.
   * Reference: default image size is tw-size-6 (24px), coloredIcon uses 36px.
   */
  readonly size = input<number>();

  readonly imageLoaded = signal(false);

  protected readonly tileSizePx = computed(() => {
    if (this.coloredIcon()) {
      return 36;
    }
    return this.size() ?? 28;
  });

  protected readonly glyphSizePx = computed(() => Math.max(13, Math.round(this.tileSizePx() * 0.54)));

  protected readonly tileStyle = computed(() => {
    const px = this.tileSizePx();
    const radius = Math.max(6, Math.round(px * 0.25));
    return {
      "--tile": `${px}px`,
      "--tile-radius": `${radius}px`,
      width: `${px}px`,
      height: `${px}px`,
    };
  });

  protected readonly tile = computed<KindPicto>(() => {
    const kind = resolveKind(CipherViewLikeUtils.getType(this.cipher()));
    return { kind, ...KIND_PICTOS[kind] };
  });

  /**
   * Computed style object for icon dimensions.
   * Centralizes the sizing logic to avoid repetition in the template.
   */
  protected readonly iconStyle = computed(() => {
    const px = this.tileSizePx();
    return { width: `${px}px`, height: `${px}px` };
  });

  protected readonly data$: Observable<CipherIconDetails>;

  constructor(
    private readonly environmentService: EnvironmentService,
    private readonly domainSettingsService: DomainSettingsService,
    private readonly configService: ConfigService,
  ) {
    const iconSettings$ = combineLatest([
      this.environmentService.environment$.pipe(map((e) => e.getIconsUrl())),
      this.domainSettingsService.showFavicons$.pipe(distinctUntilChanged()),
    ]).pipe(
      map(([iconsUrl, showFavicon]) => ({ iconsUrl, showFavicon })),
      startWith({ iconsUrl: null, showFavicon: false }), // Start with a safe default to avoid flickering icons
      distinctUntilChanged(),
    );

    const newItemTypes$ = this.configService.getFeatureFlag$(FeatureFlag.PM32009NewItemTypes);

    this.data$ = combineLatest([iconSettings$, toObservable(this.cipher), newItemTypes$]).pipe(
      map(([{ iconsUrl, showFavicon }, cipher, newItemTypes]) =>
        buildCipherIcon(iconsUrl, cipher, showFavicon, newItemTypes),
      ),
      startWith(null),
      pairwise(),
      tap(([prev, next]) => {
        if (prev?.image !== next?.image) {
          // The image changed, reset the loaded state to not show an empty icon
          this.imageLoaded.set(false);
        }
      }),
      map(([_, next]) => next!),
    );
  }
}
