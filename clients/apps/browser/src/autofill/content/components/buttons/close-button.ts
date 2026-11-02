import { css } from "@emotion/css";
import { html } from "lit";

import { Theme } from "@vowkey/common/platform/enums";

import { I18n } from "../common-types";
import { spacing, themes } from "../constants/styles";
import { Close as CloseIcon } from "../icons";

export type CloseButtonProps = {
  i18n: I18n;
  handleCloseNotification: (e: Event) => void;
  theme: Theme;
};

export function CloseButton({ handleCloseNotification, i18n, theme }: CloseButtonProps) {
  return html`
    <button
      type="button"
      aria-label=${i18n.close}
      class=${closeButtonStyles(theme)}
      @click=${handleCloseNotification}
    >
      ${CloseIcon({ theme })}
    </button>
  `;
}

const closeButtonStyles = (theme: Theme) => css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: 1px solid transparent;
  border-radius: 7px;
  background-color: transparent;
  color: ${themes[theme]?.text?.muted ?? "#6E6E77"};
  cursor: pointer;
  width: 28px;
  height: 28px;
  padding: 0;
  transition: background-color 120ms ease;

  :hover {
    background-color: ${theme === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(24, 24, 27, 0.06)"};
  }

  > svg {
    width: 16px;
    height: 16px;
    vertical-align: middle;
  }
`;
