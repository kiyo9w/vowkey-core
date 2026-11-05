import { inject, Injectable } from "@angular/core";

import { ApiService } from "../../abstractions/api.service";

export type PlanCode = "free" | "family" | "office" | "storage_plus" | "hosted_agent";

export type PlanSnapshot = {
  basePlan: PlanCode;
  storageKb: number;
  seats: number;
  decisionPerDay: number;
  decisionPerMonth: number;
  hostedAgent: boolean;
  storageUsedBytes: number;
  usedToday: number;
  usedThisMonth: number;
  creditUnits: number;
  hasPaidBase: boolean;
};

export type OrganizationPlan = PlanSnapshot & {
  organizationId: string;
  name: string;
  canManageBilling: boolean;
};

export type CatalogPrice = {
  priceId: string;
  planCode: PlanCode;
  kind: string;
  available: boolean;
  creditPack: boolean;
  billingInterval?: "month" | "year" | null;
};

export type EntitlementResponse = {
  personal: PlanSnapshot;
  organizations: OrganizationPlan[];
  catalog: CatalogPrice[];
  billingEnabled: boolean;
};

export function planNameKey(code: PlanCode): string {
  switch (code) {
    case "family":
      return "families";
    case "office":
      return "business";
    case "storage_plus":
      return "storage";
    case "hosted_agent":
      return "hostedAgent";
    default:
      return "free";
  }
}

@Injectable({ providedIn: "root" })
export class EntitlementService {
  private readonly apiService = inject(ApiService, { optional: true });

  get(): Promise<EntitlementResponse> {
    if (!this.apiService) {
      return Promise.reject(new Error("ApiService unavailable"));
    }
    return this.apiService.send("GET", "/billing/entitlement", null, true, true);
  }
}
