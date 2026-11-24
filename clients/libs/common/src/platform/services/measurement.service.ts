import { combineLatest, distinctUntilChanged, firstValueFrom, from, Subscription } from "rxjs";

import { ClientType } from "../../enums/client-type.enum";
import { DeviceTypeMetadata } from "../../enums/device-type.enum";
import { ConfigService } from "../abstractions/config/config.service";
import { EnvironmentService } from "../abstractions/environment.service";
import { I18nService } from "../abstractions/i18n.service";
import { PlatformUtilsService } from "../abstractions/platform-utils.service";

import { startCrashReports } from "./crash-reports";
import { PrivacySettingsService } from "./privacy-settings.service";
import { FillOutcome, sendFillOutcome, sendUsageCount, UsageCount } from "./usage-counts";

const SURFACES: Partial<Record<ClientType, UsageCount["surface"]>> = {
  [ClientType.Web]: "web",
  [ClientType.Browser]: "extension",
  [ClientType.Desktop]: "desktop",
};

type FillOutcomeMessage = { command: "autofillFillOutcome"; outcome: { filled: number; close: number; left: number } };

/** Turns the two stored switches into crash reports and usage counts. Both stay off until turned on. */
export class MeasurementService {
  private started = false;
  private shareUsageCounts = false;
  private subscription?: Subscription;
  private readonly fillOutcomeListener = (message: unknown) => this.onFillOutcome(message);

  constructor(
    private readonly privacySettings: PrivacySettingsService,
    private readonly configService: ConfigService,
    private readonly environmentService: EnvironmentService,
    private readonly platformUtilsService: PlatformUtilsService,
    private readonly i18nService: I18nService,
  ) {}

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    const surface = SURFACES[this.platformUtilsService.getClientType()];
    if (!surface) {
      return;
    }
    this.subscription = combineLatest([
      this.privacySettings.sendCrashReports$,
      this.privacySettings.shareUsageCounts$,
      this.configService.serverConfig$,
      from(this.platformUtilsService.getApplicationVersion()),
    ])
      .pipe(
        distinctUntilChanged(
          ([previousCrash, previousUsage, previousConfig], [nextCrash, nextUsage, nextConfig]) =>
            previousCrash === nextCrash && previousUsage === nextUsage && previousConfig?.crashDsns?.[surface] === nextConfig?.crashDsns?.[surface],
        ),
      )
      .subscribe(([sendCrashReports, shareUsageCounts, config, release]) => {
        this.shareUsageCounts = shareUsageCounts;
        startCrashReports(sendCrashReports, config?.crashDsns?.[surface] ?? "", { release, os: this.os() });
        if (shareUsageCounts) {
          void this.post({ event: "page_view", surface, os: this.os(), locale: "", page: surface });
        }
      });
    if (surface === "extension") {
      const runtime = globalThis.chrome?.runtime;
      runtime?.onMessage?.addListener(this.fillOutcomeListener);
    }
  }

  stop(): void {
    this.subscription?.unsubscribe();
    if (SURFACES[this.platformUtilsService.getClientType()] === "extension") {
      globalThis.chrome?.runtime?.onMessage?.removeListener(this.fillOutcomeListener);
    }
    this.started = false;
    this.shareUsageCounts = false;
    startCrashReports(false, "");
  }

  private onFillOutcome(message: unknown): void {
    if (!isFillOutcomeMessage(message)) {
      return;
    }
    void this.postFill(message.outcome);
  }

  private async postFill(outcome: FillOutcome): Promise<void> {
    if (!this.shareUsageCounts) {
      return;
    }
    sendFillOutcome(true, "extension", outcome, (body) => void this.send(body), this.os(), await this.locale());
  }

  private async post(count: UsageCount): Promise<void> {
    sendUsageCount(
      this.shareUsageCounts,
      { ...count, os: this.os(), locale: await this.locale() },
      (body) => void this.send(body),
    );
  }

  private async send(body: string): Promise<void> {
    const environment = await this.environmentService.getEnvironment();
    if (!environment) {
      return;
    }
    await fetch(`${environment.getApiUrl()}/counts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
      credentials: "omit",
    });
  }

  private os(): string {
    return DeviceTypeMetadata[this.platformUtilsService.getDevice()].platform.toLowerCase();
  }

  private locale(): Promise<string> {
    return firstValueFrom(this.i18nService.locale$);
  }
}

function isFillOutcomeMessage(message: unknown): message is FillOutcomeMessage {
  if (!message || typeof message !== "object" || !("command" in message) || message.command !== "autofillFillOutcome" || !("outcome" in message) || !message.outcome || typeof message.outcome !== "object") {
    return false;
  }
  const outcome = message.outcome as Record<string, unknown>;
  return ["filled", "close", "left"].every((key) => typeof outcome[key] === "number" && Number.isFinite(outcome[key]));
}
