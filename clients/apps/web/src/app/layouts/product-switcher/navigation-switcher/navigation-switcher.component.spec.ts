import { signal } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { ActivatedRoute, RouterModule } from "@angular/router";
import { mock, MockProxy } from "jest-mock-extended";
import { BehaviorSubject } from "rxjs";

import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { FakeGlobalStateProvider } from "@vowkey/common/spec";
import {
  IconButtonModule,
  NavigationModule,
  PopoverAnchorForDirective,
  SideNavService,
} from "@vowkey/components";
// FIXME: remove `src` and fix import
// eslint-disable-next-line no-restricted-imports
import { NavItemComponent } from "@vowkey/components/src/navigation/nav-item.component";
import { GlobalStateProvider } from "@vowkey/state";
import { I18nPipe } from "@vowkey/ui-common";
import { CoachmarkService, CoachmarkStepId } from "@vowkey/vault";

import { ProductSwitcherItem, ProductSwitcherService } from "../shared/product-switcher.service";

import { NavigationProductSwitcherComponent } from "./navigation-switcher.component";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: jest.fn().mockImplementation((query) => ({
    matches: true,
    media: query,
    onchange: null,
    addListener: jest.fn(), // deprecated
    removeListener: jest.fn(), // deprecated
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

describe("NavigationProductSwitcherComponent", () => {
  let fixture: ComponentFixture<NavigationProductSwitcherComponent>;
  let productSwitcherService: MockProxy<ProductSwitcherService>;

  const mockProducts$ = new BehaviorSubject<{
    bento: ProductSwitcherItem[];
    other: ProductSwitcherItem[];
  }>({
    bento: [],
    other: [],
  });

  const mockShouldShowPremiumUpgradeButton$ = new BehaviorSubject<boolean>(false);

  const activeStepId = signal<CoachmarkStepId | null>(null);
  const coachmarkService = {
    isStepActive: (stepId: CoachmarkStepId) => activeStepId() === stepId,
    getStepPosition: () => "right-start",
    getStepTitle: () => "",
    getStepDescription: () => "",
    getStepLearnMoreUrl: (): string | undefined => undefined,
    currentStepNumber: () => 1,
    totalSteps: () => 1,
  };

  beforeEach(async () => {
    productSwitcherService = mock<ProductSwitcherService>();
    productSwitcherService.products$ = mockProducts$;
    productSwitcherService.shouldShowPremiumUpgradeButton$ = mockShouldShowPremiumUpgradeButton$;
    mockProducts$.next({ bento: [], other: [] });
    activeStepId.set(null);

    const fakeGlobalStateProvider = new FakeGlobalStateProvider();

    await TestBed.configureTestingModule({
      imports: [
        RouterModule,
        NavigationModule,
        IconButtonModule,
        I18nPipe,
        NavigationProductSwitcherComponent,
      ],
      providers: [
        { provide: ProductSwitcherService, useValue: productSwitcherService },
        { provide: CoachmarkService, useValue: coachmarkService },
        {
          provide: I18nService,
          useValue: mock<I18nService>(),
        },
        {
          provide: ActivatedRoute,
          useValue: mock<ActivatedRoute>(),
        },
        {
          provide: GlobalStateProvider,
          useValue: fakeGlobalStateProvider,
        },
      ],
    }).compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(NavigationProductSwitcherComponent);
    // SideNavService.open starts false (managed by LayoutComponent's ResizeObserver in a real
    // app). Set it to true so NavItemComponent renders text labels (used in text-content checks).
    TestBed.inject(SideNavService).open.set(true);
    fixture.detectChanges();
  });

  describe("upsell suppression", () => {
    it("does not render marketing upsell links from `other` products", () => {
      mockShouldShowPremiumUpgradeButton$.next(true);
      mockProducts$.next({
        bento: [{ isActive: true, name: "Password Manager", icon: "bwi-lock", appRoute: "/vault" }],
        other: [
          {
            isActive: false,
            name: "Secrets Manager",
            icon: "bwi-cli",
            marketingRoute: {
              route: "/sm-landing",
              external: false,
            },
          },
          {
            name: "Organizations",
            icon: "bwi-business",
            marketingRoute: { route: "/create-organization", external: false },
            otherProductOverrides: { name: "Share your passwords" },
          },
        ],
      });

      fixture.detectChanges();

      expect(fixture.nativeElement.querySelectorAll("a").length).toBe(0);
      expect(fixture.nativeElement.textContent).not.toContain("Share your passwords");
      expect(fixture.nativeElement.textContent).not.toContain("Secrets Manager");
      expect(fixture.nativeElement.querySelector("app-upgrade-nav-button")).toBeNull();
    });

    it('shows the nav item as active when "isActive" is true', () => {
      mockProducts$.next({
        bento: [
          {
            name: "Organizations",
            icon: "bwi-lock",
            marketingRoute: {
              route: "https://www.example.com/",
              external: true,
            },
            isActive: true,
          },
          {
            name: "Test Product",
            icon: "bwi-lock",
            marketingRoute: {
              route: "https://www.example.com/",
              external: true,
            },
          },
        ],
        other: [],
      });

      fixture.detectChanges();

      const navItem = fixture.debugElement.queryAll(By.directive(NavItemComponent));

      expect(navItem[0].componentInstance.forceActiveStyles()).toBe(true);
    });
  });

  describe("available products", () => {
    it("shows all products", () => {
      mockProducts$.next({
        bento: [
          { isActive: true, name: "Password Manager", icon: "bwi-lock", appRoute: "/vault" },
          { isActive: false, name: "Secret Manager", icon: "bwi-lock", appRoute: "/sm" },
        ],
        other: [],
      });

      fixture.detectChanges();

      const links = fixture.nativeElement.querySelectorAll("a");

      expect(links.length).toBe(2);

      expect(links[0].textContent).toContain("Password Manager");
      expect(links[1].textContent).toContain("Secret Manager");
    });

    it("does not show products list when there is only one item", () => {
      mockProducts$.next({
        bento: [{ isActive: true, name: "Password Manager", icon: "bwi-lock", appRoute: "/vault" }],
        other: [],
      });

      fixture.detectChanges();

      const navItems = fixture.debugElement.queryAll(By.directive(NavItemComponent));

      expect(navItems.length).toBe(0);
    });
  });

  it("links to `appRoute`", () => {
    mockProducts$.next({
      bento: [
        { isActive: true, name: "Password Manager", icon: "bwi-lock", appRoute: "/vault" },
        { isActive: false, name: "Secret Manager", icon: "bwi-lock", appRoute: "/sm" },
      ],
      other: [],
    });

    fixture.detectChanges();

    const links = fixture.nativeElement.querySelectorAll("a");

    expect(links[0].getAttribute("href")).toBe("/vault");
  });

  describe("switch products coachmark", () => {
    const openAnchors = () =>
      fixture.debugElement
        .queryAll(By.directive(PopoverAnchorForDirective))
        .filter((el) => el.injector.get(PopoverAnchorForDirective).popoverOpen());

    beforeEach(() => {
      TestBed.inject(SideNavService).version.set("vfo1");
      mockProducts$.next({
        bento: [
          { isActive: true, name: "Password Manager", icon: "bwi-lock" } as ProductSwitcherItem,
        ],
        other: [],
      });
      fixture.detectChanges();
    });

    it("opens on the switcher button when the switch products step is active", () => {
      activeStepId.set("switchProducts");
      fixture.detectChanges();

      expect(openAnchors().map((el) => el.name)).toEqual(["button"]);
    });

    it("stays closed while another step is active", () => {
      activeStepId.set("vaultList");
      fixture.detectChanges();

      expect(openAnchors()).toEqual([]);
    });
  });
});
