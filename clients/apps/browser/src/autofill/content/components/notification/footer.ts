import { css } from "@emotion/css";
import { html } from "lit";

import { Theme } from "@vowkey/common/platform/enums";

import {
  NotificationType,
  NotificationTypes,
} from "../../../notification/abstractions/notification-bar";
import { OrgView, FolderView, I18n, CollectionView } from "../common-types";
import { spacing } from "../constants/styles";

import { NotificationButtonRow } from "./button-row";

export type NotificationFooterProps = {
  activeMode?: "new" | "update";
  collections?: CollectionView[];
  folders?: FolderView[];
  i18n: I18n;
  isLoading?: boolean;
  notificationType?: NotificationType;
  organizations?: OrgView[];
  personalVaultIsAllowed: boolean;
  theme: Theme;
  handleSaveAction: (e: Event) => void;
  handleNeverSave?: (e: Event) => void;
};

export function NotificationFooter({
  activeMode,
  collections,
  folders,
  i18n,
  isLoading,
  notificationType,
  organizations,
  personalVaultIsAllowed,
  theme,
  handleSaveAction,
  handleNeverSave,
}: NotificationFooterProps) {
  const isUnlockNotification = notificationType === NotificationTypes.Unlock;
  const resolvedMode =
    activeMode ?? (notificationType === NotificationTypes.Change ? "update" : "new");
  const isUpdateMode = !isUnlockNotification && resolvedMode === "update";

  let primaryButtonText = i18n.saveAction || "Save";

  if (isUnlockNotification) {
    primaryButtonText = i18n.notificationUnlock || "Unlock";
  } else if (isUpdateMode) {
    primaryButtonText = i18n.notificationUpdate || "Update";
  }

  const secondaryButton =
    !isUnlockNotification && !isUpdateMode && handleNeverSave
      ? {
          text: i18n.never || "Never",
          dataTestId: "notification-never-button",
          handleSecondaryButtonClick: handleNeverSave,
        }
      : undefined;

  return html`
    <div class=${notificationFooterStyles}>
      ${NotificationButtonRow({
        collections: isUpdateMode ? [] : collections,
        folders: isUpdateMode ? [] : folders,
        organizations: isUpdateMode ? [] : organizations,
        i18n,
        primaryButton: {
          handlePrimaryButtonClick: handleSaveAction,
          isLoading,
          text: primaryButtonText,
        },
        secondaryButton,
        personalVaultIsAllowed,
        theme,
      })}
    </div>
  `;
}

const notificationFooterStyles = css`
  display: flex;
  padding: 10px 14px 12px 14px;

  :last-child {
    border-radius: 0 0 14px 14px;
  }
`;
