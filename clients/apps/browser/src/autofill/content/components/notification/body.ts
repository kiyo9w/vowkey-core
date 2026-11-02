import createEmotion from "@emotion/css/create-instance";
import { html } from "lit";

import { Theme, ThemeTypes } from "@vowkey/common/platform/enums";

import { NotificationType } from "../../../notification/abstractions/notification-bar";
import { NotificationCipherData } from "../cipher/types";
import { I18n } from "../common-types";
import { scrollbarStyles, spacing, themes, typography } from "../constants/styles";
import { CipherItemRow } from "../rows/cipher-item-row";

export const componentClassPrefix = "notification-body";

const { css } = createEmotion({
  key: componentClassPrefix,
});

export type NotificationBodyProps = {
  ciphers?: NotificationCipherData[];
  i18n: I18n;
  notificationType?: NotificationType;
  theme: Theme;
  handleEditOrUpdateAction: (e: Event) => void;
  selectedCipherId?: string | null;
  onSelectCipher?: (cipherId: string) => void;
};

export function NotificationBody({
  ciphers = [],
  i18n,
  notificationType,
  theme = ThemeTypes.Light,
  handleEditOrUpdateAction,
  selectedCipherId,
  onSelectCipher,
}: NotificationBodyProps) {
  const isSafari = false;
  const isSelectable = ciphers.length > 1 && Boolean(onSelectCipher);

  return html`
    <div class=${notificationBodyStyles({ isSafari, theme })}>
      ${ciphers.map((cipher) =>
        CipherItemRow({
          cipher,
          theme,
          i18n,
          notificationType,
          handleAction: handleEditOrUpdateAction,
          isSelected: isSelectable && Boolean(cipher.id) && cipher.id === selectedCipherId,
          isSelectable,
          onSelect: onSelectCipher,
        }),
      )}
    </div>
  `;
}

const notificationBodyStyles = ({ isSafari, theme }: { isSafari: boolean; theme: Theme }) => css`
  ${typography.body1}

  gap: ${spacing["1.5"]};
  display: flex;
  flex-flow: column;
  background-color: ${themes[theme].background.alt};
  max-height: 123px;
  overflow-x: hidden;
  overflow-y: auto;
  white-space: nowrap;
  color: ${themes[theme].text.main};
  font-weight: 400;

  :last-child {
    border-radius: 0 0 ${spacing["4"]} ${spacing["4"]};
  }

  ${isSafari ? scrollbarStyles(theme).safari : scrollbarStyles(theme).default}
`;
