import { Theme } from "@vowkey/common/platform/enums";

import { EditButton } from "../../../content/components/buttons/edit-button";
import { NotificationTypes } from "../../../notification/abstractions/notification-bar";
import { I18n } from "../common-types";
import { selectedCipher as selectedCipherSignal } from "../signals/selected-cipher";

export type CipherActionProps = {
  cipherId: string;
  handleAction?: (e: Event) => void;
  i18n: I18n;
  itemName: string;
  notificationType: typeof NotificationTypes.Change | typeof NotificationTypes.Add;
  theme: Theme;
  username?: string;
};

export function CipherAction({
  cipherId,
  handleAction = () => {
    /* no-op */
  },
  i18n,
  theme,
}: CipherActionProps) {
  const selectCipherHandleAction = (e: Event) => {
    e.stopPropagation();
    if (cipherId) {
      selectedCipherSignal.set(cipherId);
    }
    handleAction(e);
  };
  return EditButton({
    buttonAction: selectCipherHandleAction,
    buttonText: i18n.notificationEditTooltip || i18n.notificationEdit || "Edit",
    theme,
  });
}
