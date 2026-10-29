import { TestBed } from "@angular/core/testing";
import { Route, UrlSegment } from "@angular/router";
import { firstValueFrom, of } from "rxjs";

import { FeatureFlag } from "@vowkey/common/enums/feature-flag.enum";
import { ConfigService } from "@vowkey/common/platform/abstractions/config/config.service";

import { routes } from "./app-routing.module";

function findRoute(candidates: Route[], path: string): Route[] {
  return candidates.flatMap((route) => [
    ...(route.path === path ? [route] : []),
    ...findRoute(route.children ?? [], path),
  ]);
}

describe("desktop import route", () => {
  // canMatch on the parent route (not canActivate, and not just on the children) is what keeps
  // the whole subtree unreachable while the flag is off.
  // TODO: remove once pm-35053-import-upgrade is retired
  it("gates the entire subtree on the ImportUpgrade flag via canMatch", async () => {
    const importRoutes = findRoute(routes, "import");
    expect(importRoutes).toHaveLength(1);
    expect(importRoutes[0].canMatch).toHaveLength(1);

    const getFeatureFlag$ = jest.fn();
    TestBed.configureTestingModule({
      providers: [{ provide: ConfigService, useValue: { getFeatureFlag$ } }],
    });
    const canMatch = importRoutes[0].canMatch![0];
    const route = {} as Route;
    const segments = [] as UrlSegment[];

    getFeatureFlag$.mockReturnValue(of(false));
    const whenOff = await firstValueFrom(
      TestBed.runInInjectionContext(() => canMatch(route, segments)) as any,
    );
    expect(whenOff).toBe(false);
    expect(getFeatureFlag$).toHaveBeenCalledWith(FeatureFlag.ImportUpgrade);

    getFeatureFlag$.mockReturnValue(of(true));
    const whenOn = await firstValueFrom(
      TestBed.runInInjectionContext(() => canMatch(route, segments)) as any,
    );
    expect(whenOn).toBe(true);
  });
});
