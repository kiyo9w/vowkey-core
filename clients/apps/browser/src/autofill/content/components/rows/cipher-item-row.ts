import { css } from "@emotion/css";
import { html } from "lit";

import { Theme } from "@vowkey/common/platform/enums";

import { NotificationType } from "../../../notification/abstractions/notification-bar";
import { CipherItem } from "../cipher/cipher-item";
import { NotificationCipherData } from "../cipher/types";
import { I18n } from "../common-types";
import { spacing, themes, typography } from "../constants/styles";

export type CipherItemRowProps = {
  cipher: NotificationCipherData;
  i18n: I18n;
  notificationType?: NotificationType;
  theme: Theme;
  handleAction: (e: Event) => void;
  isSelected?: boolean;
  isSelectable?: boolean;
  onSelect?: (cipherId: string) => void;
};

export function CipherItemRow({
  cipher,
  i18n,
  notificationType,
  theme,
  handleAction,
  isSelected = false,
  isSelectable = false,
  onSelect,
}: CipherItemRowProps) {
  const handleRowClick = () => {
    if (isSelectable && cipher.id && onSelect) {
      onSelect(cipher.id);
    }
  };

  return html`
    <div
      class=${cipherItemRowStyles({ theme, isSelected, isSelectable })}
      data-testid="notification-cipher-row"
      @click=${handleRowClick}
    >
      ${CipherItem({
        cipher,
        i18n,
        notificationType,
        theme,
        handleAction,
      })}
    </div>
  `;
}

const cipherItemRowStyles = ({
  theme,
  isSelected,
  isSelectable,
}: {
  theme: Theme;
  isSelected: boolean;
  isSelectable: boolean;
}) => css`
  ${typography.body1}

  gap: ${spacing["2"]};
  display: flex;
  align-items: center;
  justify-content: space-between;
  border: 1px solid
    ${
      isSelected
        ? themes[theme].primary["600"]
        : theme === "dark"
          ? "#32353E"
          : "rgba(24, 24, 27, 0.08)"
    };
  border-radius: 10px;
  background-color: ${
    isSelected
      ? theme === "dark"
        ? "rgba(59, 130, 246, 0.12)"
        : "rgba(37, 99, 235, 0.04)"
      : themes[theme].background.DEFAULT
  };
  padding: 9px 11px;
  min-height: 46px;
  max-height: 54px;
  overflow-x: hidden;
  white-space: nowrap;
  color: ${themes[theme].text.main};
  font-weight: 400;
  cursor: ${isSelectable ? "pointer" : "default"};
  transition: border-color 120ms ease, background-color 120ms ease;

  > div {
    :first-child {
      flex: 3 3 78%;
      min-width: 25%;
    }

    :not(:first-child) {
      display: flex;
      flex-direction: row;
      flex-wrap: nowrap;
      justify-content: flex-end;
      max-width: 22%;

      > button {
        max-width: min-content;
      }
    }
  }
`;
