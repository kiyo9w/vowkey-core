import { importProvidersFrom } from "@angular/core";
import { applicationConfig, Meta, moduleMetadata, StoryObj } from "@storybook/angular";
import { BehaviorSubject, of } from "rxjs";

import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { EventCollectionService } from "@vowkey/common/dirt/event-logs";
import { ConfigService } from "@vowkey/common/platform/abstractions/config/config.service";
import { LogService } from "@vowkey/common/platform/abstractions/log.service";
import { PlatformUtilsService } from "@vowkey/common/platform/abstractions/platform-utils.service";
import { ValidationService } from "@vowkey/common/platform/abstractions/validation.service";
import { DefaultServerSettingsService } from "@vowkey/common/platform/services/default-server-settings.service";
import { UserId } from "@vowkey/common/types/guid";
import { ToastService } from "@vowkey/components";
import {
  OrganizationInviteLinkService,
  OrganizationInviteLinkView,
} from "@vowkey/organization-invite-link";

import { PreloadedEnglishI18nModule } from "../../../../../core/tests";

import { ByLinkTabComponent } from "./by-link-tab.component";

const mockInviteLinkUrl =
  "https://vault.example.com/#/joinOrganization?organizationId=org-1&orgUserToken=abc123&orgName=Acme+Corp";

const mockInviteLink: OrganizationInviteLinkView = Object.assign(
  new OrganizationInviteLinkView({} as any),
  {
    id: "link-1",
    organizationId: "org-1",
    allowedDomains: ["example.com", "acme.org"],
    supportsConfirmation: true,
    creationDate: "2025-01-15T10:30:00Z",
    url: mockInviteLinkUrl,
  },
);

const mockAccountService = {
  activeAccount$: of({ id: "user-1" as UserId, email: "test@example.com" }),
};

const mockPlatformUtilsService = {
  copyToClipboard: () => {},
  isSelfHost: () => false,
};

const mockToastService = {
  showToast: () => {},
};

const mockEventCollectionService = {
  collect: () => Promise.resolve(),
  collectMany: () => Promise.resolve(),
};

const mockLogService = {
  error: () => {},
};

const mockServerSettingsService = {
  isEmailVerificationDisabled$: of(false),
};

type StoryArgs = {
  /** Whether `pm-34429-invite-link-auto-confirm` is on, which is what reveals the switch. */
  autoConfirmEnabled: boolean;
};

export default {
  title: "Admin Console/Organizations/Members/Invite Members Dialog/By Link Tab",
  component: ByLinkTabComponent,
  args: {
    autoConfirmEnabled: true,
  },
  argTypes: {
    autoConfirmEnabled: {
      control: "boolean",
      description:
        "Whether the pm-34429-invite-link-auto-confirm flag is on. The 'require admin confirmation' switch only renders when it is, and only once a link exists.",
    },
  },
  decorators: [
    moduleMetadata({
      imports: [ByLinkTabComponent],
      providers: [
        { provide: AccountService, useValue: mockAccountService },
        { provide: PlatformUtilsService, useValue: mockPlatformUtilsService },
        { provide: ToastService, useValue: mockToastService },
        { provide: EventCollectionService, useValue: mockEventCollectionService },
        { provide: LogService, useValue: mockLogService },
        { provide: DefaultServerSettingsService, useValue: mockServerSettingsService },
      ],
    }),
    applicationConfig({
      providers: [importProvidersFrom(PreloadedEnglishI18nModule)],
    }),
  ],
} as Meta<StoryArgs>;

type Story = StoryObj<StoryArgs>;

const makeRender =
  (initialLink: OrganizationInviteLinkView | undefined): Story["render"] =>
  (args) => {
    const inviteLink$ = new BehaviorSubject<OrganizationInviteLinkView | undefined>(initialLink);

    const patchLink = (patch: Partial<OrganizationInviteLinkView>) => {
      const current = inviteLink$.getValue();
      inviteLink$.next(
        Object.assign(new OrganizationInviteLinkView({} as any), {
          ...mockInviteLink,
          creationDate: current?.creationDate ?? new Date().toISOString(),
          supportsConfirmation:
            current?.supportsConfirmation ?? mockInviteLink.supportsConfirmation,
          ...patch,
        }),
      );
      return Promise.resolve();
    };

    const upsertLink = (_userId: unknown, _orgId: unknown, domains: string[]) =>
      patchLink({ allowedDomains: domains });

    return {
      moduleMetadata: {
        providers: [
          {
            provide: ConfigService,
            useValue: {
              getFeatureFlag$: () => of(args.autoConfirmEnabled),
            },
          },
          {
            provide: ValidationService,
            useValue: { showError: () => {} },
          },
          {
            provide: OrganizationInviteLinkService,
            useValue: {
              inviteLink$: () => inviteLink$.asObservable(),
              create: (
                _userId: unknown,
                _orgId: unknown,
                domains: string[],
                supportsConfirmation: boolean,
              ) => patchLink({ allowedDomains: domains, supportsConfirmation }),
              updateAllowedDomains: upsertLink,
              setInviteConfirmation: (
                _userId: unknown,
                _orgId: unknown,
                supportsConfirmation: boolean,
              ) => patchLink({ supportsConfirmation }),
              refresh: (_userId: unknown, _orgId: unknown, supportsConfirmation: boolean) =>
                patchLink({ supportsConfirmation }),
              delete: () => {
                inviteLink$.next(undefined);
                return Promise.resolve();
              },
            },
          },
        ],
      },
      template: `<app-by-link-tab organizationId="org-1"></app-by-link-tab>`,
    };
  };

/**
 * Fresh state — callout prompts user to enter domains before generating a link.
 */
export const NoLinkYet: Story = {
  render: makeRender(undefined),
};

/**
 * Link is generated — shows URL in disabled input with refresh + copy icon buttons and creation date hint.
 *
 * `supportsConfirmation: true` is the link-confirm flow, so the switch reads as off.
 */
export const LinkExists: Story = {
  args: {},
  render: makeRender(mockInviteLink),
};

/**
 * An existing link on the accept flow (`supportsConfirmation: false`), so the switch reads as on
 * and invitees wait on an admin.
 */
export const LinkRequiringAdminConfirmation: Story = {
  args: {},
  render: makeRender(
    Object.assign(new OrganizationInviteLinkView({} as any), {
      ...mockInviteLink,
      supportsConfirmation: false,
    }),
  ),
};

/**
 * Flag off — the switch is absent and links keep being created without confirmation support.
 */
export const LinkExistsWithFlagOff: Story = {
  args: {
    autoConfirmEnabled: false,
  },
  render: makeRender(mockInviteLink),
};
