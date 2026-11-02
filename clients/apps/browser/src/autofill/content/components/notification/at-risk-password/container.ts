import { css } from "@emotion/css";
import { html, nothing } from "lit";

import { Theme, ThemeTypes } from "@vowkey/common/platform/enums";

import {
  AtRiskPasswordNotificationParams,
  NotificationBarIframeInitData,
} from "../../../../notification/abstractions/notification-bar";
import { I18n } from "../../common-types";
import { themes, spacing } from "../../constants/styles";
import {
  NotificationHeader,
  componentClassPrefix as notificationHeaderClassPrefix,
} from "../header";

import { AtRiskNotificationBody } from "./body";
import { AtRiskNotificationFooter } from "./footer";

export type AtRiskNotificationProps = NotificationBarIframeInitData & {
  /**
   * Click handler for the "Change password" button. When omitted, the button
   * is not rendered and the notification body instructs the user to navigate
   * to the site manually.
   */
  handleChangePasswordClick?: (e: Event) => void;
  handleCloseNotification: (e: Event) => void;
  i18n: I18n;
  notificationTestId: string;
  params: AtRiskPasswordNotificationParams;
};

export function AtRiskNotification({
  handleChangePasswordClick,
  handleCloseNotification,
  i18n,
  notificationTestId,
  theme = ThemeTypes.Light,
  params,
}: AtRiskNotificationProps) {
  const { hasPasswordChangeUri, organizationName } = params;
  const riskMessage = chrome.i18n.getMessage(
    hasPasswordChangeUri ? "atRiskChangePrompt" : "atRiskNavigatePromptV2",
    organizationName,
  );

  return html`
    <div data-testid="${notificationTestId}" class=${atRiskNotificationContainerStyles(theme)}>
      ${NotificationHeader({
        handleCloseNotification,
        i18n,
        message: i18n.atRiskPassword,
        theme,
      })}
      ${AtRiskNotificationBody({
        theme,
        riskMessage,
      })}
      ${
        handleChangePasswordClick
          ? AtRiskNotificationFooter({
              i18n,
              theme,
              handleChangePasswordClick,
            })
          : nothing
      }
    </div>
  `;
}

const atRiskNotificationContainerStyles = (theme: Theme) => css`
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
