import { ChangeDetectorRef, OnDestroy, Optional, Pipe, PipeTransform } from "@angular/core";
import { Subscription } from "rxjs";

import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";

/**
 * Localizes the specified string and updates live when the active locale changes.
 *
 * @example
 * {{ 'key' | i18n }}
 *
 * @example
 * {{ 'key' | i18n: 'param1' }}
 */
@Pipe({
  name: "i18n",
  pure: false,
})
export class I18nPipe implements PipeTransform, OnDestroy {
  private lastKey = "";
  private lastP1?: string | number;
  private lastP2?: string | number;
  private lastP3?: string | number;
  private lastLocale?: string;
  private lastValue = "";
  private hasCachedValue = false;
  private localeSub?: Subscription;

  constructor(
    private i18nService: I18nService,
    @Optional() private cdr?: ChangeDetectorRef,
  ) {
    this.localeSub = this.i18nService.locale$?.subscribe?.(() => {
      this.hasCachedValue = false;
      this.cdr?.markForCheck();
    });
  }

  transform(id: string, p1?: string | number, p2?: string | number, p3?: string | number): string {
    const currentLocale = this.i18nService.translationLocale;
    if (
      this.hasCachedValue &&
      id === this.lastKey &&
      p1 === this.lastP1 &&
      p2 === this.lastP2 &&
      p3 === this.lastP3 &&
      currentLocale === this.lastLocale
    ) {
      return this.lastValue;
    }
    this.lastKey = id;
    this.lastP1 = p1;
    this.lastP2 = p2;
    this.lastP3 = p3;
    this.lastLocale = currentLocale;
    this.lastValue = this.i18nService.t(id, p1, p2, p3);
    this.hasCachedValue = true;
    return this.lastValue;
  }

  ngOnDestroy(): void {
    this.localeSub?.unsubscribe();
  }
}
