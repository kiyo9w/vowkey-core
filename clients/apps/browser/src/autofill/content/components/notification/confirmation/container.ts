import { css } from "@emotion/css";
import { html, nothing } from "lit";

import { Theme, ThemeTypes } from "@vowkey/common/platform/enums";

import {
  NotificationBarIframeInitData,
  NotificationTaskInfo,
  NotificationType,
  NotificationTypes,
} from "../../../../notification/abstractions/notification-bar";
import { I18n } from "../../common-types";
import { themes, spacing } from "../../constants/styles";
import {
  NotificationHeader,
  componentClassPrefix as notificationHeaderClassPrefix,
} from "../header";

import { NotificationConfirmationBody } from "./body";
import { NotificationConfirmationFooter } from "./footer";

export type NotificationConfirmationContainerProps = NotificationBarIframeInitData & {
  handleCloseNotification: (e: Event) => void;
  handleOpenVault: (e: Event) => void;
  handleOpenTasks: (e: Event) => void;
} & {
  error?: string;
  headerMessage?: string;
  i18n: I18n;
  itemName: string;
  notificationTestId: string;
  task?: NotificationTaskInfo;
  type: NotificationType;
};

export function NotificationConfirmationContainer({
  error,
  handleCloseNotification,
  handleOpenVault,
  handleOpenTasks,
  headerMessage,
  i18n,
  itemName,
  notificationTestId,
  task,
  theme = ThemeTypes.Light,
  type,
}: NotificationConfirmationContainerProps) {
  const confirmationMessage = getConfirmationMessage(i18n, type, error);
  const buttonText = error ? i18n.newItem : i18n.view;
  const buttonAria = error
    ? i18n.notificationNewItemAria
    : chrome.i18n.getMessage("notificationViewAria", [itemName]);

  let messageDetails: string | undefined;
  let remainingTasksCount: number | undefined;
  let tasksAreComplete: boolean = true;

  if (task && !error) {
    remainingTasksCount = task.remainingTasksCount || 0;
    tasksAreComplete = remainingTasksCount === 0;

    if (task.orgName !== null && task.orgName !== undefined) {
      messageDetails =
        remainingTasksCount > 0
          ? chrome.i18n.getMessage("loginUpdateTaskSuccessAdditional", [
              task.orgName,
              `${remainingTasksCount}`,
            ])
          : chrome.i18n.getMessage("loginUpdateTaskSuccess", [task.orgName]);
    }
  }

  return html`
    <div data-testid="${notificationTestId}" class=${notificationContainerStyles(theme)}>
      ${NotificationHeader({
        handleCloseNotification,
        i18n,
        message: headerMessage,
        theme,
      })}
      ${NotificationConfirmationBody({
        buttonAria,
        buttonText,
        confirmationMessage,
        error,
        itemName,
        messageDetails,
        tasksAreComplete,
        theme,
        handleOpenVault,
      })}
      ${
        !error && remainingTasksCount
          ? NotificationConfirmationFooter({
              i18n,
              theme,
              handleButtonClick: handleOpenTasks,
            })
          : nothing
      }
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
  overflow: hidden;

  [class*="${notificationHeaderClassPrefix}-"] {
    border-radius: 14px 14px 0 0;
    border-bottom: 1px solid ${themes[theme]?.secondary?.["300"] ?? "rgba(24, 24, 27, 0.08)"};
  }
`;

function getConfirmationMessage(i18n: I18n, type?: NotificationType, error?: string) {
  if (error) {
    return i18n.saveFailureDetails;
  }

  /* @TODO This partial string return and later concatenation with the cipher name is needed
   * to handle cipher name overflow cases, but is risky for i18n concerns. Fix concatenation
   * with cipher name overflow when a tag replacement solution is available.
   */
  return type === NotificationTypes.Add
    ? i18n.notificationLoginSaveConfirmation
    : i18n.notificationLoginUpdatedConfirmation;
}
