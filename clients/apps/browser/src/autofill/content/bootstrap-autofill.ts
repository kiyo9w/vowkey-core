import DomElementVisibilityService from "../services/dom-element-visibility.service";
import { DomQueryService } from "../services/dom-query.service";
import { setupAutofillInitDisconnectAction } from "../utils";

import AutofillInit from "./autofill-init";

(function (windowContext) {
  if (!windowContext.vowkeyAutofillInit) {
    const domQueryService = new DomQueryService();
    const domElementVisibilityService = new DomElementVisibilityService();
    windowContext.vowkeyAutofillInit = new AutofillInit(
      domQueryService,
      domElementVisibilityService,
    );
    setupAutofillInitDisconnectAction(windowContext);

    windowContext.vowkeyAutofillInit.init();
  }
})(window);
