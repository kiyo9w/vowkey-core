import { css } from "@emotion/css";
import { html, nothing } from "lit";

import { Theme } from "@vowkey/common/platform/enums";

import { ActionButton } from "../../../content/components/buttons/action-button";
import { spacing, themes } from "../../../content/components/constants/styles";
import { EventSecurity } from "../../../utils/event-security";
import { Option } from "../common-types";
import { optionSelectionTagName } from "../option-selection/option-selection";

export type ButtonRowProps = {
  theme: Theme;
  primaryButton: {
    text: string;
    isLoading?: boolean;
    handlePrimaryButtonClick: (args: any) => void;
  };
  secondaryButton?: {
    text: string;
    dataTestId?: string;
    handleSecondaryButtonClick: (e: Event) => void;
  };
  selectButtons?: {
    id: string;
    label?: string;
    options: Option[];
    handleSelectionUpdate?: (args: any) => void;
    selectedSignal?: { set: (value: any) => void };
  }[];
};

export function ButtonRow({
  theme,
  primaryButton,
  secondaryButton,
  selectButtons,
}: ButtonRowProps) {
  const hasSelects = Boolean(selectButtons && selectButtons.length > 0);

  return html`
    <div class=${buttonRowStyles}>
      <div class=${optionSelectionsStyles}>
        ${
          hasSelects
            ? selectButtons?.map(
                ({ id, label, options, handleSelectionUpdate, selectedSignal }) =>
                  html`
                    <option-selection
                      key=${id}
                      theme=${theme}
                      .id=${id}
                      .label=${label}
                      .options=${options}
                      .handleSelectionUpdate=${handleSelectionUpdate}
                      .selectedSignal=${selectedSignal}
                    ></option-selection>
                  ` || nothing,
              )
            : secondaryButton
              ? html`
                  <button
                    type="button"
                    data-testid=${secondaryButton.dataTestId || "notification-secondary-button"}
                    class=${secondaryButtonStyles(theme)}
                    @click=${(event: Event) => {
                      if (EventSecurity.isEventTrusted(event)) {
                        secondaryButton.handleSecondaryButtonClick(event);
                      }
                    }}
                  >
                    ${secondaryButton.text}
                  </button>
                `
              : nothing
        }
      </div>
      ${ActionButton({
        handleClick: primaryButton.handlePrimaryButtonClick,
        buttonText: primaryButton.text,
        dataTestId: "notification-primary-action",
        fullWidth: false,
        isLoading: primaryButton.isLoading,
        theme,
      })}
    </div>
  `;
}

const buttonRowStyles = css`
  gap: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  max-height: 44px;
  white-space: nowrap;

  > button {
    flex: 0 0 auto;
    min-width: 88px;
  }

  > div {
    flex: 1 1 auto;
    min-width: 0;
  }
`;

const optionSelectionsStyles = css`
  gap: ${spacing["2"]};
  display: flex;
  align-items: center;
  justify-content: flex-start;
  overflow: hidden;

  > ${optionSelectionTagName} {
    max-width: calc(50% - ${spacing["1"]});
    min-width: 112px;
  }
`;

const secondaryButtonStyles = (theme: Theme) => css`
  user-select: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid ${theme === "dark" ? "#32353E" : "rgba(24, 24, 27, 0.10)"};
  background-color: transparent;
  color: ${themes[theme]?.text?.muted ?? "#6E6E77"};
  font-family: "Be Vietnam Pro", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;

  :hover {
    background-color: ${theme === "dark" ? "rgba(255, 255, 255, 0.06)" : "rgba(24, 24, 27, 0.05)"};
    color: ${themes[theme]?.text?.main ?? "#18181B"};
  }
`;
