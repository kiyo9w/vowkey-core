import { css } from "@emotion/css";
import { html, nothing } from "lit";

import { Theme, ThemeTypes } from "@vowkey/common/platform/enums";

import {
  NotificationBarIframeInitData,
  NotificationTypes,
  NotificationType,
} from "../../../notification/abstractions/notification-bar";
import { EventSecurity } from "../../../utils/event-security";
import { NotificationCipherData } from "../cipher/types";
import { CollectionView, FolderView, I18n, OrgView } from "../common-types";
import { themes } from "../constants/styles";

import { NotificationBody, componentClassPrefix as notificationBodyClassPrefix } from "./body";
import { NotificationFooter } from "./footer";
import {
  NotificationHeader,
  componentClassPrefix as notificationHeaderClassPrefix,
} from "./header";

export type NotificationCredentialMode = "new" | "update";

export type NotificationContainerProps = NotificationBarIframeInitData & {
  handleCloseNotification: (e: Event) => void;
  handleSaveAction: (e: Event) => void;
  handleEditOrUpdateAction: (e: Event) => void;
  handleNeverSave?: (e: Event) => void;
  handleModeChange?: (mode: NotificationCredentialMode) => void;
  handleSelectCipher?: (cipherId: string) => void;
} & {
  activeMode?: NotificationCredentialMode;
  canUpdateExisting?: boolean;
  ciphers?: NotificationCipherData[];
  collections?: CollectionView[];
  folders?: FolderView[];
  headerMessage?: string;
  i18n: I18n;
  isLoading?: boolean;
  organizations?: OrgView[];
  personalVaultIsAllowed?: boolean;
  selectedCipherId?: string | null;
  notificationTestId: string;
  type: NotificationType;
};

export function NotificationContainer({
  activeMode,
  canUpdateExisting,
  handleCloseNotification,
  handleEditOrUpdateAction,
  handleModeChange,
  handleNeverSave,
  handleSaveAction,
  handleSelectCipher,
  ciphers,
  collections,
  folders,
  headerMessage,
  i18n,
  isLoading,
  organizations,
  personalVaultIsAllowed = true,
  selectedCipherId,
  notificationTestId,
  theme = ThemeTypes.Light,
  type,
}: NotificationContainerProps) {
  const showBody = type !== NotificationTypes.Unlock;
  const showSegmentedControl =
    type === NotificationTypes.Add || type === NotificationTypes.Change;
  const resolvedMode: NotificationCredentialMode =
    activeMode ?? (type === NotificationTypes.Change ? "update" : "new");

  const allCiphers = ciphers ?? [];
  const existingCiphers = allCiphers.filter((cipher) => !cipher.isNewDraft);
  const draftCipher =
    allCiphers.find((cipher) => cipher.isNewDraft) ??
    (existingCiphers[0]
      ? {
          ...existingCiphers[0],
          id: "",
          isNewDraft: true,
        }
      : undefined);

  const resolvedCanUpdate =
    canUpdateExisting ?? (type === NotificationTypes.Change || existingCiphers.length > 0);

  const visibleCiphers =
    resolvedMode === "new"
      ? draftCipher
        ? [draftCipher]
        : allCiphers.slice(0, 1)
      : existingCiphers.length > 0
        ? existingCiphers
        : allCiphers;

  const resolvedHeaderMessage = showSegmentedControl
    ? resolvedMode === "update"
      ? i18n.updateLogin || headerMessage
      : i18n.saveLogin || headerMessage
    : headerMessage;

  const selectMode = (mode: NotificationCredentialMode, event: Event) => {
    if (!EventSecurity.isEventTrusted(event)) {
      return;
    }
    if (mode === "update" && !resolvedCanUpdate) {
      return;
    }
    if (mode !== resolvedMode) {
      handleModeChange?.(mode);
    }
  };

  return html`
    <div data-testid="${notificationTestId}" class=${notificationContainerStyles(theme)}>
      ${NotificationHeader({
        handleCloseNotification,
        i18n,
        message: resolvedHeaderMessage,
        theme,
      })}
      ${
        showSegmentedControl
          ? html`
              <div
                class=${segmentedBarStyles(theme)}
                role="tablist"
                data-testid="notification-mode-tabs"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected=${resolvedMode === "new"}
                  data-testid="notification-mode-new"
                  class=${segmentedPillStyles({
                    active: resolvedMode === "new",
                    disabled: false,
                    theme,
                  })}
                  @click=${(e: Event) => selectMode("new", e)}
                >
                  ${i18n.newItem || "New item"}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected=${resolvedMode === "update"}
                  aria-disabled=${!resolvedCanUpdate}
                  ?disabled=${!resolvedCanUpdate}
                  data-testid="notification-mode-update"
                  class=${segmentedPillStyles({
                    active: resolvedMode === "update",
                    disabled: !resolvedCanUpdate,
                    theme,
                  })}
                  @click=${(e: Event) => selectMode("update", e)}
                >
                  ${i18n.updateExisting || "Update existing"}
                </button>
              </div>
            `
          : nothing
      }
      ${
        showBody
          ? NotificationBody({
              handleEditOrUpdateAction,
              ciphers: visibleCiphers,
              notificationType: resolvedMode === "update" ? NotificationTypes.Change : type,
              theme,
              i18n,
              selectedCipherId,
              onSelectCipher: resolvedMode === "update" ? handleSelectCipher : undefined,
            })
          : nothing
      }
      ${NotificationFooter({
        activeMode: resolvedMode,
        handleSaveAction,
        handleNeverSave: type === NotificationTypes.Add ? handleNeverSave : undefined,
        collections,
        folders,
        i18n,
        isLoading,
        notificationType: type,
        organizations,
        personalVaultIsAllowed,
        theme,
      })}
    </div>
  `;
}

const notificationContainerStyles = (theme: Theme) => css`
  position: absolute;
  top: 6px;
  right: 16px;
  border: 1px solid ${theme === ThemeTypes.Dark ? "#2A2C33" : "rgba(24, 24, 27, 0.10)"};
  border-radius: 14px;
  box-shadow: ${
    theme === ThemeTypes.Dark
      ? "0 16px 40px -8px rgba(0, 0, 0, 0.45), 0 2px 8px rgba(0, 0, 0, 0.25)"
      : "0 16px 40px -8px rgba(24, 24, 27, 0.18), 0 2px 8px rgba(24, 24, 27, 0.06)"
  };
  background-color: ${themes[theme]?.background?.alt ?? "#FAF9F6"};
  width: 360px;
  box-sizing: border-box;

  [class*="${notificationHeaderClassPrefix}-"] {
    border-radius: 14px 14px 0 0;
  }

  [class*="${notificationBodyClassPrefix}-"] {
    margin: 0 14px;
    padding-right: 0;
  }
`;

const segmentedBarStyles = (theme: Theme) => css`
  margin: 0 14px 10px 14px;
  padding: 3px;
  border-radius: 9px;
  background-color: ${
    theme === ThemeTypes.Dark ? "rgba(255, 255, 255, 0.07)" : "rgba(24, 24, 27, 0.06)"
  };
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 3px;
`;

const segmentedPillStyles = ({
  active,
  disabled,
  theme,
}: {
  active: boolean;
  disabled: boolean;
  theme: Theme;
}) => css`
  user-select: none;
  height: 28px;
  border: 0;
  border-radius: 7px;
  padding: 0 8px;
  font-family: "Be Vietnam Pro", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 12px;
  font-weight: 600;
  line-height: 16px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: background-color 120ms ease, color 120ms ease, box-shadow 120ms ease;

  ${
    active
      ? `
    background-color: ${theme === ThemeTypes.Dark ? "#2C2E37" : "#FFFFFF"};
    color: ${themes[theme]?.text?.main ?? "#18181B"};
    box-shadow: 0 1px 2px rgba(24, 24, 27, 0.08);
    cursor: default;
  `
      : disabled
        ? `
    background-color: transparent;
    color: ${themes[theme]?.text?.muted ?? "#6E6E77"};
    opacity: 0.45;
    cursor: default;
  `
        : `
    background-color: transparent;
    color: ${themes[theme]?.text?.muted ?? "#6E6E77"};
    cursor: pointer;

    :hover {
      color: ${themes[theme]?.text?.main ?? "#18181B"};
    }
  `
  }
`;
