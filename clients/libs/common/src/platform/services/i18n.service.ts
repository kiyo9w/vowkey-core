// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import {
  BehaviorSubject,
  Observable,
  combineLatest,
  distinctUntilChanged,
  firstValueFrom,
  map,
  skip,
} from "rxjs";

import { I18nService as I18nServiceAbstraction } from "../abstractions/i18n.service";
import { GlobalState, GlobalStateProvider, KeyDefinition, TRANSLATION_DISK } from "../state";

import { TranslationService } from "./translation.service";

const LOCALE_KEY = new KeyDefinition<string>(TRANSLATION_DISK, "locale", {
  deserializer: (value) => value,
});

export class I18nService extends TranslationService implements I18nServiceAbstraction {
  translationLocale: string;
  protected translationLocaleState: GlobalState<string>;
  private readonly reloadTick$ = new BehaviorSubject<number>(0);
  userSetLocale$: Observable<string | undefined>;
  locale$: Observable<string>;

  constructor(
    protected systemLanguage: string,
    protected localesDirectory: string,
    protected getLocalesJson: (formattedLocale: string) => Promise<any>,
    globalStateProvider: GlobalStateProvider,
  ) {
    super(systemLanguage, localesDirectory, getLocalesJson);
    this.translationLocaleState = globalStateProvider.get(LOCALE_KEY);
    this.userSetLocale$ = this.translationLocaleState.state$;
    this.locale$ = combineLatest([this.userSetLocale$, this.reloadTick$]).pipe(
      map(([locale]) => this.translationLocale ?? locale ?? this.defaultLocale),
      distinctUntilChanged(),
    );
  }

  async setLocale(locale: string | null): Promise<void> {
    if (this.inited) {
      await this.applyLocale(locale ?? undefined);
      this.reloadTick$.next(this.reloadTick$.value + 1);
    }
    await this.translationLocaleState.update(() => locale);
  }

  override async init() {
    const storedLocale = await firstValueFrom(this.translationLocaleState.state$);
    await super.init(storedLocale);
    this.reloadTick$.next(this.reloadTick$.value + 1);
    this.userSetLocale$.pipe(skip(1)).subscribe((locale) => {
      const target = this.resolveLocale(locale ?? undefined);
      if (target !== this.translationLocale) {
        void this.applyLocale(locale ?? undefined).then(() => {
          this.reloadTick$.next(this.reloadTick$.value + 1);
        });
      }
    });
  }
}
