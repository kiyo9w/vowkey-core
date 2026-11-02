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
        maxHeight: "280px",
        backgroundColor: "#FAF9F6",
        boxShadow: "0 12px 32px -6px rgba(24, 24, 27, 0.16), 0 2px 6px rgba(24, 24, 27, 0.06)",
        borderRadius: "12px",
        borderWidth: "1px",
        borderStyle: "solid",
        borderColor: "rgba(24, 24, 27, 0.10)",
      },
      chrome.i18n.getMessage("vowkeyVault"),
    );
  }
}
