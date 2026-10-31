import { EVENTS, TYPE_CHECK } from "@vowkey/common/autofill/constants";
import { WriteOutcome } from "@vowkey/common/vault/agent/targets";

import AutofillScript, { FillScript, FillScriptActionTypes } from "../models/autofill-script";
import { FormFieldElement } from "../types";
import {
  currentlyInSandboxedIframe,
  elementIsFillableFormField,
  elementIsInputElement,
  isReadonlyOrDisabledFormFieldElement,
} from "../utils";

import { DomElementVisibilityService } from "./abstractions/dom-element-visibility.service";
import { InsertAutofillContentService as InsertAutofillContentServiceInterface } from "./abstractions/insert-autofill-content.service";
import { CollectAutofillContentService } from "./collect-autofill-content.service";

class InsertAutofillContentService implements InsertAutofillContentServiceInterface {
  private readonly autofillInsertActions = {
    fill_by_opid: ({ opid, value }: { opid: string; value: string }, showAnimations = true) =>
      this.handleFillFieldByOpidAction(opid, value, showAnimations),
    click_on_opid: ({ opid }: { opid: string }) => this.handleClickOnFieldByOpidAction(opid),
    focus_by_opid: ({ opid }: { opid: string }) => this.handleFocusOnFieldByOpidAction(opid),
  };
  private readonly profileValues = new WeakMap<FormFieldElement, string | boolean>();

  /**
   * InsertAutofillContentService constructor. Instantiates the
   * DomElementVisibilityService and CollectAutofillContentService classes.
   */
  constructor(
    private domElementVisibilityService: DomElementVisibilityService,
    private collectAutofillContentService: CollectAutofillContentService,
  ) {}

  /**
   * Handles autofill of the forms on the current page based on the
   * data within the passed fill script object.
   * @param {AutofillScript} fillScript
   * @param {boolean} showAnimations
   * @returns {Promise<void>}
   * @public
   */
  async fillForm(fillScript: AutofillScript, showAnimations: boolean = true) {
    if (
      !fillScript.script?.length ||
      currentlyInSandboxedIframe() ||
      this.userCancelledInsecureUrlAutofill(fillScript.requiresInsecurePageConfirmation) ||
      this.userCancelledUntrustedIframeAutofill(fillScript)
    ) {
      return;
    }

    for (let index = 0; index < fillScript.script.length; index++) {
      await this.runFillScriptAction(
        fillScript.script[index],
        fillScript.properties.preserveUserEdits,
        showAnimations,
      );
    }
  }

  async fillObservedField(element: FormFieldElement, value: string): Promise<WriteOutcome> {
    if (!element.isConnected || element.ownerDocument !== document || value === "" ||
      isReadonlyOrDisabledFormFieldElement(element)) {
      return "not_written";
    }
    const toggle = element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type);
    if (toggle) {
      if (element.checked || !["true", "y", "1", "yes", "✓"].includes(value.toLowerCase())) {
        return "not_written";
      }
    } else if (("value" in element ? element.value : element.innerText) !== "") {
      return "not_written";
    }
    if (element instanceof HTMLSelectElement) {
      const option = Array.from(element.options).find((option) =>
        option.text === value || option.value === value,
      );
      if (option == null) {
        return "not_written";
      }
      value = option.value;
    }
    try {
      this.insertValueIntoField(element, value);
      await Promise.resolve();
      const confirmed = element.isConnected && (toggle
        ? (element as HTMLInputElement).checked
        : ("value" in element ? element.value : element.innerText) === value);
      return confirmed ? "confirmed" : "not_confirmed";
    } catch {
      return "not_confirmed";
    }
  }

  /**
   * Checks if the autofill is occurring on a page that can be considered secure. If the page is not secure,
   * the user is prompted to confirm that they want to autofill on the page.
   * The background determines whether the cipher holds an HTTPS URI that applies to this page.
   * @param {boolean} requiresInsecurePageConfirmation
   * @returns {boolean}
   * @private
   */
  private userCancelledInsecureUrlAutofill(requiresInsecurePageConfirmation?: boolean): boolean {
    if (
      !requiresInsecurePageConfirmation ||
      globalThis.location.protocol !== "http:" ||
      !this.isPasswordFieldWithinDocument()
    ) {
      return false;
    }

    const confirmationWarning = [
      chrome.i18n.getMessage("insecurePageWarning"),
      chrome.i18n.getMessage("insecurePageWarningFillPrompt", [globalThis.location.hostname]),
    ].join("\n\n");

    return !globalThis.confirm(confirmationWarning);
  }

  /**
   * Checks if there is a password field within the current document. Includes
   * password fields that are present within the shadow DOM.
   * @returns {boolean}
   * @private
   */
  private isPasswordFieldWithinDocument(): boolean {
    return this.collectAutofillContentService.isPasswordFieldWithinDocument();
  }

  /**
   * Checking if the autofill is occurring within an untrusted iframe. If the page is within an untrusted iframe,
   * the user is prompted to confirm that they want to autofill on the page. If the user cancels the autofill,
   * the script will not continue.
   *
   * Note: confirm() is blocked by sandboxed iframes, but we don't want to fill sandboxed iframes anyway.
   * If this occurs, confirm() returns false without displaying the dialog box, and autofill will be aborted.
   * The browser may print a message to the console, but this is not a standard error that we can handle.
   * @param {AutofillScript} fillScript
   * @returns {boolean}
   * @private
   */
  private userCancelledUntrustedIframeAutofill(fillScript: AutofillScript): boolean {
    if (!fillScript.untrustedIframe) {
      return false;
    }

    const confirmationWarning = [
      chrome.i18n.getMessage("autofillIframeWarning"),
      chrome.i18n.getMessage("autofillIframeWarningTip", [globalThis.location.hostname]),
    ].join("\n\n");

    return !globalThis.confirm(confirmationWarning);
  }

  /**
   * Runs the autofill action based on the action type and the opid.
   * Each action is subsequently delayed by 20 milliseconds.
   * @param {FillScript} [action, opid, value]
   * @returns {Promise<void>}
   * @private
   */
  private runFillScriptAction = (
    [action, opid, value]: FillScript,
    preserveUserEdits?: boolean,
    showAnimations = true,
  ): Promise<void> => {
    if (!opid || !this.autofillInsertActions[action]) {
      return Promise.resolve();
    }

    const delayActionsInMilliseconds = 20;
    return new Promise((resolve) =>
      setTimeout(() => {
        if (preserveUserEdits !== undefined) {
          if (action === FillScriptActionTypes.fill_by_opid && value?.length) {
            const element = this.collectAutofillContentService.getAutofillFieldElementByOpid(opid);
            this.insertValueIntoField(element, value, preserveUserEdits, showAnimations);
          }
          resolve();
          return;
        }

        if (action === FillScriptActionTypes.fill_by_opid && !!value?.length) {
          this.autofillInsertActions.fill_by_opid({ opid, value }, showAnimations);
        } else if (action === FillScriptActionTypes.click_on_opid) {
          this.autofillInsertActions.click_on_opid({ opid });
        } else if (action === FillScriptActionTypes.focus_by_opid) {
          this.autofillInsertActions.focus_by_opid({ opid });
        }

        resolve();
      }, delayActionsInMilliseconds),
    );
  };

  /**
   * Queries the DOM for an element by opid and inserts the passed value into the element.
   * @param {string} opid
   * @param {string} value
   * @private
   */
  private handleFillFieldByOpidAction(opid: string, value: string, showAnimations = true) {
    const element = this.collectAutofillContentService.getAutofillFieldElementByOpid(opid);
    this.insertValueIntoField(element, value, undefined, showAnimations);
  }

  /**
   * Handles finding an element by opid and triggering a click event on the element.
   * @param {string} opid
   * @private
   */
  private handleClickOnFieldByOpidAction(opid: string) {
    const element = this.collectAutofillContentService.getAutofillFieldElementByOpid(opid);

    if (element) {
      this.triggerClickOnElement(element);
    }
  }

  /**
   * Handles finding an element by opid and triggering click and focus events on the element.
   * To ensure that we trigger a blur event correctly on a filled field, we first check if the
   * element is already focused. If it is, we blur the element before focusing on it again.
   *
   * @param {string} opid - The opid of the element to focus on.
   */
  private handleFocusOnFieldByOpidAction(opid: string) {
    const element = this.collectAutofillContentService.getAutofillFieldElementByOpid(opid);

    if (!element) {
      return;
    }

    if (document.activeElement === element) {
      element.blur();
    }

    this.simulateUserMouseClickAndFocusEventInteractions(element, true);
  }

  private getProfileFieldValue(element: FormFieldElement): string | boolean {
    if (elementIsInputElement(element) && ["checkbox", "radio"].includes(element.type)) {
      return element.checked;
    }
    return "value" in element ? element.value : element.innerText || element.textContent || "";
  }

  private canFillProfileField(element: FormFieldElement): boolean {
    const value = this.getProfileFieldValue(element);
    const previous = this.profileValues.get(element);
    if (previous !== undefined) {
      if (value !== previous) {
        return false;
      }
    } else if (typeof value === "boolean" ? value : value.trim() !== "") {
      return false;
    }

    if (elementIsInputElement(element) && element.type === "radio" && element.name) {
      const radios = (element.getRootNode() as Document | ShadowRoot).querySelectorAll<HTMLInputElement>(
        'input[type="radio"]',
      );
      for (const radio of radios) {
        if (radio.name !== element.name || radio.form !== element.form) {
          continue;
        }
        const previousRadioValue = this.profileValues.get(radio);
        if ((previousRadioValue !== undefined && previousRadioValue !== radio.checked) ||
          (radio.checked && previousRadioValue !== true)) {
          return false;
        }
      }
    }
    return true;
  }

  /**
   * Identifies the type of element passed and inserts the value into the element.
   * Will trigger simulated events on the element to ensure that the element is
   * properly updated.
   * @param {FormFieldElement | null} element
   * @param {string} value
   * @private
   */
  private insertValueIntoField(
    element: FormFieldElement | null,
    value: string,
    preserveUserEdits?: boolean,
    showAnimations = true,
  ) {
    if (!element || !value) {
      return;
    }

    const isProfileToggle =
      preserveUserEdits !== undefined &&
      elementIsInputElement(element) &&
      ["checkbox", "radio"].includes(element.type);
    const elementValue = (element as HTMLInputElement)?.value || element?.innerText || "";
    const elementAlreadyHasTheValue =
      !isProfileToggle && !!(elementValue?.length && elementValue === value);

    if (elementAlreadyHasTheValue || isReadonlyOrDisabledFormFieldElement(element)) {
      return;
    }

    if (!elementIsFillableFormField(element)) {
      this.handleInsertValueAndTriggerSimulatedEvents(
        element,
        () => (element.innerText = value),
        preserveUserEdits,
        showAnimations,
      );
      return;
    }

    if (isProfileToggle) {
      this.handleInsertValueAndTriggerSimulatedEvents(
        element,
        () => (element.checked = ["true", "y", "1", "yes", "✓"].includes(value.toLowerCase())),
        preserveUserEdits,
        showAnimations,
      );
      return;
    }

    const isFillableCheckboxOrRadioElement =
      elementIsInputElement(element) &&
      new Set(["checkbox", "radio"]).has(element.type) &&
      new Set(["true", "y", "1", "yes", "✓"]).has(String(value).toLowerCase());
    if (isFillableCheckboxOrRadioElement) {
      this.handleInsertValueAndTriggerSimulatedEvents(
        element,
        () => (element.checked = true),
        preserveUserEdits,
        showAnimations,
      );
      return;
    }

    this.handleInsertValueAndTriggerSimulatedEvents(
      element,
      () => {
        const proto = Object.getPrototypeOf(element);
        const setter = proto ? Object.getOwnPropertyDescriptor(proto, "value")?.set : undefined;
        if (setter) {
          setter.call(element, value);
        } else {
          element.value = value;
        }
      },
      preserveUserEdits,
      showAnimations,
    );
  }

  /**
   * Simulates pre- and post-insert events on the element meant to mimic user interactions
   * while inserting the autofill value into the element.
   * @param {FormFieldElement} element
   * @param {Function} valueChangeCallback
   * @private
   */
  private handleInsertValueAndTriggerSimulatedEvents(
    element: FormFieldElement,
    valueChangeCallback: CallableFunction,
    preserveUserEdits?: boolean,
    showAnimations = true,
  ): void {
    if (preserveUserEdits && !this.canFillProfileField(element)) {
      return;
    }
    if (preserveUserEdits !== undefined) {
      if (!elementIsInputElement(element) || !["checkbox", "radio"].includes(element.type)) {
        this.triggerClickOnElement(element);
      }
      if (preserveUserEdits && !this.canFillProfileField(element)) {
        return;
      }
      this.triggerFocusOnElement(element);
      if (preserveUserEdits && !this.canFillProfileField(element)) {
        return;
      }
      this.simulateUserKeyboardEventInteractions(element);
    } else {
      this.triggerPreInsertEventsOnElement(element);
    }
    if (preserveUserEdits && !this.canFillProfileField(element)) {
      return;
    }
    const ownedRadios =
      preserveUserEdits !== undefined && elementIsInputElement(element) &&
      element.type === "radio" && element.name
        ? Array.from((element.getRootNode() as Document | ShadowRoot).querySelectorAll<HTMLInputElement>(
            'input[type="radio"]',
          )).filter((radio) => radio.name === element.name && radio.form === element.form &&
            this.profileValues.has(radio))
        : undefined;
    valueChangeCallback();
    if (preserveUserEdits !== undefined) {
      this.simulateUserKeyboardEventInteractions(element);
      this.simulateInputElementChangedEvent(element);
    } else {
      this.triggerPostInsertEventsOnElement(element);
    }
    if (preserveUserEdits !== undefined) {
      this.profileValues.set(element, this.getProfileFieldValue(element));
      if (ownedRadios) {
        for (const radio of ownedRadios) {
          this.profileValues.set(radio, radio.checked);
        }
      }
    }
    this.triggerFillAnimationOnElement(element, showAnimations);
  }

  /**
   * Simulates a mouse click event on the element, including focusing the event, and
   * the triggers a simulated keyboard event on the element. Will attempt to ensure
   * that the initial element value is not arbitrarily changed by the simulated events.
   * @param {FormFieldElement} element
   * @private
   */
  private triggerPreInsertEventsOnElement(element: FormFieldElement): void {
    const initialElementValue = "value" in element ? element.value : "";

    this.simulateUserMouseClickAndFocusEventInteractions(element);
    this.simulateUserKeyboardEventInteractions(element);

    if ("value" in element && initialElementValue !== element.value) {
      element.value = initialElementValue;
    }
  }

  /**
   * Simulates a keyboard event on the element before assigning the autofilled value to the element, and then
   * simulates an input change event on the element to trigger expected events after autofill occurs.
   * @param {FormFieldElement} element
   * @private
   */
  private triggerPostInsertEventsOnElement(element: FormFieldElement): void {
    const autofilledValue = "value" in element ? element.value : "";
    this.simulateUserKeyboardEventInteractions(element);

    if ("value" in element && autofilledValue !== element.value) {
      element.value = autofilledValue;
    }

    this.simulateInputElementChangedEvent(element);
  }

  /**
   * Identifies if a passed element can be animated and sets a class on the element
   * to trigger a CSS animation. The animation is removed after a short delay.
   * @param {FormFieldElement} element
   * @private
   */
  private triggerFillAnimationOnElement(element: FormFieldElement, showAnimations = true): void {
    if (!showAnimations) {
      return;
    }

    const skipAnimatingElement =
      elementIsFillableFormField(element) &&
      !new Set(["email", "text", "password", "number", "tel", "url"]).has(element?.type);

    if (this.domElementVisibilityService.isElementHiddenByCss(element) || skipAnimatingElement) {
      return;
    }

    element.classList.add("com-vowkey-browser-animated-fill");
    setTimeout(() => element.classList.remove("com-vowkey-browser-animated-fill"), 200);
  }

  /**
   * Simulates a click  event on the element.
   * @param {HTMLElement} element
   * @private
   */
  private triggerClickOnElement(element?: HTMLElement): void {
    if (!element || typeof element.click !== TYPE_CHECK.FUNCTION) {
      return;
    }

    element.click();
  }

  /**
   * Simulates a focus event on the element. Will optionally reset the value of the element
   * if the element has a value property.
   * @param {HTMLElement | undefined} element
   * @param {boolean} shouldResetValue
   * @private
   */
  private triggerFocusOnElement(element: HTMLElement | undefined, shouldResetValue = false): void {
    if (!element || typeof element.focus !== TYPE_CHECK.FUNCTION) {
      return;
    }

    let initialValue = "";
    if (shouldResetValue && "value" in element) {
      initialValue = String(element.value);
    }

    element.focus();

    if (initialValue && "value" in element) {
      element.value = initialValue;
    }
  }

  /**
   * Simulates a mouse click and focus event on the element.
   * @param {FormFieldElement} element
   * @param {boolean} shouldResetValue
   * @private
   */
  private simulateUserMouseClickAndFocusEventInteractions(
    element: FormFieldElement,
    shouldResetValue = false,
  ): void {
    this.triggerClickOnElement(element);
    this.triggerFocusOnElement(element, shouldResetValue);
  }

  /**
   * Simulates several keyboard events on the element, mocking a user interaction with the element.
   * @param {FormFieldElement} element
   * @private
   */
  private simulateUserKeyboardEventInteractions(element: FormFieldElement): void {
    const simulatedKeyboardEvents = [EVENTS.KEYDOWN, EVENTS.KEYUP];
    for (let index = 0; index < simulatedKeyboardEvents.length; index++) {
      element.dispatchEvent(new KeyboardEvent(simulatedKeyboardEvents[index], { bubbles: true }));
    }
  }

  /**
   * Simulates an input change event on the element, mocking behavior that would occur if a user
   * manually changed a value for the element.
   * @param {FormFieldElement} element
   * @private
   */
  private simulateInputElementChangedEvent(element: FormFieldElement): void {
    const simulatedInputEvents = [EVENTS.INPUT, EVENTS.CHANGE];
    for (let index = 0; index < simulatedInputEvents.length; index++) {
      element.dispatchEvent(new Event(simulatedInputEvents[index], { bubbles: true }));
    }
  }
}

export default InsertAutofillContentService;
