import { firstValueFrom } from "rxjs";

import { EnvironmentService } from "../abstractions/environment.service";

/**
 * Whether the configured sync server answers. Sign-in and sign-up are offered only when it does,
 * so a person never lands on a page that cannot work.
 */
export async function syncServerAnswers(environmentService: EnvironmentService): Promise<boolean> {
  try {
    const environment = await firstValueFrom(environmentService.environment$);
    const response = await fetch(`${environment.getApiUrl().replace(/\/$/, "")}/alive`, {
      signal: AbortSignal.timeout(4_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
