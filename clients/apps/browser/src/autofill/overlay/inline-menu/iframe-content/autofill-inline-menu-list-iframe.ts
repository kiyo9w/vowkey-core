import { AutofillOverlayPort } from "../../../enums/autofill-overlay.enum";

import { AutofillInlineMenuIframeElement } from "./autofill-inline-menu-iframe-element";

export class AutofillInlineMenuListIframe extends AutofillInlineMenuIframeElement {
  constructor(element: HTMLElement) {
    super(
      element,
      AutofillOverlayPort.List,
      {
        height: "0px",
        minWidth: "280px",
        maxHeight: "180px",
        boxShadow: "0 18px 44px -12px rgba(20, 24, 40, 0.3), 0 2px 8px rgba(20, 24, 40, 0.08)",
        borderRadius: "14px",
        borderWidth: "1px",
        borderStyle: "solid",
        borderColor: "rgba(18, 18, 22, 0.1)",
      },
      chrome.i18n.getMessage("vowkeyVault"),
    );
  }
}
