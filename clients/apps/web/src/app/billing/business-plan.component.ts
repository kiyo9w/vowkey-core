import { ChangeDetectionStrategy, Component, computed, inject, signal } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { ActivatedRoute } from "@angular/router";
import { combineLatest, map } from "rxjs";

import {
  CatalogPrice,
  PlanCode,
  PlanSnapshot,
  planNameKey,
} from "@vowkey/common/billing/services/entitlement.service";
import { ErrorResponse } from "@vowkey/common/models/response/error.response";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";

import { HeaderModule } from "../layouts/header/header.module";
import { SharedModule } from "../shared";

import { BusinessBillingService } from "./services/business-billing.service";

@Component({
  selector: "app-business-plan",
  templateUrl: "business-plan.component.html",
  imports: [SharedModule, HeaderModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BusinessPlanComponent {
  private readonly billing = inject(BusinessBillingService);
  private readonly i18n = inject(I18nService);
  private readonly route = inject(ActivatedRoute);

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly personal = signal<PlanSnapshot | null>(null);
  protected readonly organizations = signal<
    (PlanSnapshot & { organizationId: string; name: string; canManageBilling: boolean })[]
  >([]);
  protected readonly catalog = signal<CatalogPrice[]>([]);
  protected readonly billingEnabled = signal(false);
  protected readonly priceId = signal("");
  protected readonly quantity = signal(1);

  /** organizationId is on the parent admin-console route, not this lazy child. */
  protected readonly organizationId = toSignal(
    combineLatest(this.route.pathFromRoot.map((route) => route.paramMap)).pipe(
      map(
        (maps) =>
          maps.map((params) => params.get("organizationId")).find((id) => id != null) ?? null,
      ),
    ),
    { initialValue: null },
  );

  protected readonly organization = computed(() => {
    const id = this.organizationId();
    return id ? (this.organizations().find((org) => org.organizationId === id) ?? null) : null;
  });

  protected readonly plan = computed(() =>
    this.organizationId() ? this.organization() : this.personal(),
  );

  protected readonly canManage = computed(() => {
    const org = this.organization();
    return this.organizationId() == null || org?.canManageBilling === true;
  });

  protected readonly offers = computed(() => {
    const plan = this.plan();
    if (!this.billingEnabled() || !this.canManage() || !plan) {
      return [];
    }
    const paidBase = this.billing.hasPaidBase(plan);
    return this.catalog().filter((price) => {
      if (!price.available || !price.priceId) {
        return false;
      }
      if (price.creditPack) {
        return price.planCode === "hosted_agent";
      }
      if (price.planCode === "office") {
        return this.organization() != null && !paidBase;
      }
      if (price.kind === "base" || price.planCode === "family") {
        return this.organization() == null && !paidBase;
      }
      return price.kind === "addon";
    });
  });

  protected readonly selected = computed(
    () => this.offers().find((price) => price.priceId === this.priceId()) ?? null,
  );

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const response = await this.billing.entitlement();
      this.personal.set(response.personal);
      this.organizations.set(response.organizations ?? []);
      this.catalog.set(response.catalog ?? []);
      this.billingEnabled.set(response.billingEnabled === true);
      if (!response.catalog?.some((price) => price.priceId === this.priceId())) {
        this.priceId.set("");
      }
    } catch (error: unknown) {
      this.error.set(messageOf(error) || this.i18n.t("errorOccurred"));
    } finally {
      this.loading.set(false);
    }
  }

  protected planName(code: PlanCode | undefined): string {
    return this.i18n.t(planNameKey(code ?? "free"));
  }

  protected cadence(price: CatalogPrice): string {
    if (price.creditPack) {
      return this.i18n.t("credits");
    }
    if (price.billingInterval === "month") {
      return this.i18n.t("monthly");
    }
    return price.billingInterval === "year" ? this.i18n.t("annually") : "";
  }

  protected storageLabel(plan: PlanSnapshot): string {
    return `${formatBytes(plan.storageUsedBytes)} / ${formatBytes(plan.storageKb * 1024)}`;
  }

  protected setQuantity(value: string): void {
    const parsed = Number.parseInt(value, 10);
    this.quantity.set(Number.isFinite(parsed) && parsed > 0 ? parsed : 1);
  }

  protected async buy(): Promise<void> {
    const price = this.selected();
    if (!price || this.busy()) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const session = await this.billing.checkout({
        planCode: price.planCode,
        quantity: price.planCode === "office" ? this.quantity() : 1,
        organizationId: this.organization()?.organizationId,
        priceId: price.priceId,
        creditPack: price.creditPack,
      });
      await this.billing.openCheckout(session);
      await this.load();
    } catch (error: unknown) {
      this.error.set(messageOf(error) || this.i18n.t("errorOccurred"));
    } finally {
      this.busy.set(false);
    }
  }

  protected async manage(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const portal = await this.billing.portal(this.organization()?.organizationId);
      window.location.assign(portal.url);
    } catch (error: unknown) {
      this.error.set(messageOf(error) || this.i18n.t("errorOccurred"));
      this.busy.set(false);
    }
  }


}

function messageOf(error: unknown): string {
  if (error instanceof ErrorResponse) {
    return error.getSingleMessage();
  }
  return error instanceof Error ? error.message : "";
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}
