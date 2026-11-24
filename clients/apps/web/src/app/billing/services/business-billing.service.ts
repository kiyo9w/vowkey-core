import { Injectable } from "@angular/core";

import { ApiService } from "@vowkey/common/abstractions/api.service";

import {
  EntitlementResponse,
  EntitlementService,
  PlanCode,
  PlanSnapshot,
} from "@vowkey/common/billing/services/entitlement.service";

export type CheckoutSession = {
  transactionId: string;
  clientToken: string;
  environment: string;
};

type PaddleCheckout = {
  Environment: { set: (environment: string) => void };
  Initialized?: boolean;
  Update: (options: { eventCallback: (event: { name?: string }) => void }) => void;
  Initialize: (options: {
    token: string;
    eventCallback?: (event: { name?: string }) => void;
  }) => void;
  Checkout: { open: (options: { transactionId: string }) => void };
};

declare global {
  interface Window {
    Paddle?: PaddleCheckout;
  }
}

@Injectable({ providedIn: "root" })
export class BusinessBillingService {
  constructor(
    private readonly apiService: ApiService,
    private readonly entitlements: EntitlementService,
  ) {}

  entitlement(): Promise<EntitlementResponse> {
    return this.entitlements.get();
  }

  checkout(body: {
    planCode: PlanCode;
    quantity: number;
    organizationId?: string;
    priceId?: string;
    creditPack?: boolean;
  }): Promise<CheckoutSession> {
    return this.apiService.send("POST", "/billing/checkout", body, true, true);
  }

  portal(organizationId?: string): Promise<{ url: string }> {
    const query = organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : "";
    return this.apiService.send("GET", `/billing/portal${query}`, null, true, true);
  }

  /** A paid base is changed in the portal, never bought again. */
  hasPaidBase(plan: PlanSnapshot | null): boolean {
    return plan?.hasPaidBase === true;
  }

  async openCheckout(session: CheckoutSession): Promise<void> {
    const paddle = await this.loadPaddle(session.clientToken, session.environment);
    await new Promise<void>((resolve, reject) => {
      const eventCallback = (event: { name?: string }) => {
        if (event.name === "checkout.closed" || event.name === "checkout.completed") {
          resolve();
        } else if (event.name === "checkout.error") {
          reject(new Error("Paddle checkout could not open"));
        }
      };
      if (paddle.Initialized) {
        paddle.Update({ eventCallback });
      } else {
        paddle.Initialize({ token: session.clientToken, eventCallback });
      }
      paddle.Checkout.open({ transactionId: session.transactionId });
    });
  }

  private paddleReady: Promise<PaddleCheckout> | null = null;

  private loadPaddle(token: string, environment: string): Promise<PaddleCheckout> {
    if (!token) {
      return Promise.reject(new Error("Missing checkout token"));
    }
    this.paddleReady ??= this.attachPaddle(environment);
    return this.paddleReady;
  }

  private attachPaddle(environment: string): Promise<PaddleCheckout> {
    let resolveReady!: (paddle: PaddleCheckout) => void;
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<PaddleCheckout>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const finish = () => {
      const paddle = window.Paddle;
      if (!paddle) {
        rejectReady(new Error("Paddle.js did not load"));
        return;
      }
      paddle.Environment.set(environment === "production" ? "production" : "sandbox");
      resolveReady(paddle);
    };
    if (window.Paddle) {
      finish();
      return ready;
    }
    const existing = document.querySelector<HTMLScriptElement>('script[data-paddle="checkout"]');
    const script = existing ?? document.createElement("script");
    script.dataset.paddle = "checkout";
    script.src = "https://cdn.paddle.com/paddle/v2/paddle.js";
    script.async = true;
    script.onload = finish;
    script.onerror = () => rejectReady(new Error("Paddle.js did not load"));
    if (!existing) {
      document.head.appendChild(script);
    }
    return ready;
  }
}
