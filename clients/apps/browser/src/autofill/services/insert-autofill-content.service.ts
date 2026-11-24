import { EVENTS, TYPE_CHECK } from "@vowkey/common/autofill/constants";
import { WriteOutcome } from "@vowkey/common/vault/agent/targets";
import { matchesRadioOption, resolveSelectOption } from "@vowkey/common/vault/local";

import AutofillScript, {
  FillScript,
  FillScriptActionTypes,
  VowkeyFillSummary,
} from "../models/autofill-script";
import { FormFieldElement } from "../types";
import {
  currentlyInSandboxedIframe,
  elementIsAriaComboboxElement,
  elementIsFillableFormField,
  elementIsInputElement,
  elementIsSpanElement,
  getAttributeBoolean,
  getRadioGroupCandidates,
  getRadioOptionLabel,
  isReadonlyOrDisabledFormFieldElement,
} from "../utils";

import { DomElementVisibilityService } from "./abstractions/dom-element-visibility.service";
import { InsertAutofillContentService as InsertAutofillContentServiceInterface } from "./abstractions/insert-autofill-content.service";
import { CollectAutofillContentService } from "./collect-autofill-content.service";

const AFFIRMATIVE_TOGGLE_VALUES = new Set(["true", "y", "1", "yes", "✓"]);

class InsertAutofillContentService implements InsertAutofillContentServiceInterface {
  private readonly autofillInsertActions = {
    fill_by_opid: ({ opid, value }: { opid: string; value: string }, showAnimations = true) =>
      this.handleFillFieldByOpidAction(opid, value, showAnimations),
    click_on_opid: ({ opid }: { opid: string }) => this.handleClickOnFieldByOpidAction(opid),
    focus_by_opid: ({ opid }: { opid: string }) => this.handleFocusOnFieldByOpidAction(opid),
  };
  private readonly profileValues = new WeakMap<FormFieldElement, string | boolean>();
  private currentStepIsCloseCall = false;
  private currentAnimationDurationMs = 200;
  private fastBulkProfileFill = false;

  constructor(
    private domElementVisibilityService: DomElementVisibilityService,
    private collectAutofillContentService: CollectAutofillContentService,
  ) {}

  async fillForm(fillScript: AutofillScript, showAnimations: boolean = true) {
    if (
      !fillScript.script?.length ||
      currentlyInSandboxedIframe() ||
      this.userCancelledInsecureUrlAutofill(fillScript.requiresInsecurePageConfirmation) ||
      this.userCancelledUntrustedIframeAutofill(fillScript)
    ) {
      return;
    }

    const summary = fillScript.properties.vowkeyFillSummary;
    const closeCallSet = new Set(summary?.closeCallOpids ?? []);
    this.currentAnimationDurationMs = summary ? 1200 : 200;
    this.fastBulkProfileFill =
      fillScript.properties.preserveUserEdits !== undefined && fillScript.script.length > 6;

    try {
      for (let index = 0; index < fillScript.script.length; index++) {
        const step = fillScript.script[index];
        this.currentStepIsCloseCall = Boolean(step[1] && closeCallSet.has(step[1]));
        await this.runFillScriptAction(
          step,
          fillScript.properties.preserveUserEdits,
          showAnimations,
        );
      }
    } finally {
      this.currentStepIsCloseCall = false;
      this.currentAnimationDurationMs = 200;
      this.fastBulkProfileFill = false;
    }

    if (summary) {
      void chrome.runtime.sendMessage({ command: "autofillFillOutcome", outcome: { filled: summary.filledCount, close: summary.closeCallOpids?.length ?? 0, left: summary.missingCount } });
    }
    if (showAnimations && summary && summary.filledCount > 0) {
      this.showFillSummaryPill(summary);
    }
  }

  async fillObservedField(element: FormFieldElement, value: string): Promise<WriteOutcome> {
    if (!element.isConnected || element.ownerDocument !== document || value === "") {
      return "not_written";
    }

    if (elementIsAriaComboboxElement(element)) {
      if (this.isDisabledOrAriaReadonly(element)) {
        return "not_written";
      }
      const existing = this.getProfileFieldValue(element);
      if (typeof existing === "string" && existing.trim() !== "") {
        return "not_written";
      }
      const wrote = await this.fillAriaCombobox(element, value, undefined, false);
      return wrote ? "confirmed" : "not_confirmed";
    }

    if (isReadonlyOrDisabledFormFieldElement(element)) {
      return "not_written";
    }

    if (element instanceof HTMLInputElement && element.type === "radio") {
      if (element.checked || !this.shouldCheckRadioElement(element, value)) {
        return "not_written";
      }
      try {
        this.insertValueIntoField(element, value, undefined, false);
        await Promise.resolve();
        return element.isConnected && element.checked ? "confirmed" : "not_confirmed";
      } catch {
        return "not_confirmed";
      }
    }

    const isCheckbox = element instanceof HTMLInputElement && element.type === "checkbox";
    if (isCheckbox) {
      if (element.checked || !AFFIRMATIVE_TOGGLE_VALUES.has(value.toLowerCase())) {
        return "not_written";
      }
    } else if (("value" in element ? element.value : element.innerText) !== "") {
      return "not_written";
    }
    if (element instanceof HTMLSelectElement) {
      const resolvedValue = this.resolveSelectOptionValue(element, value);
      if (resolvedValue == null) {
        return "not_written";
      }
      value = resolvedValue;
    }
    try {
      this.insertValueIntoField(element, value);
      await Promise.resolve();
      const confirmed =
        element.isConnected &&
        (isCheckbox
          ? (element as HTMLInputElement).checked
          : ("value" in element ? element.value : element.innerText) === value);
      return confirmed ? "confirmed" : "not_confirmed";
    } catch {
      return "not_confirmed";
    }
  }

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

  private isPasswordFieldWithinDocument(): boolean {
    return this.collectAutofillContentService.isPasswordFieldWithinDocument();
  }

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

  private runFillScriptAction = (
    [action, opid, value]: FillScript,
    preserveUserEdits?: boolean,
    showAnimations = true,
  ): Promise<void> => {
    if (!opid || !this.autofillInsertActions[action]) {
      return Promise.resolve();
    }

    if (
      this.fastBulkProfileFill &&
      preserveUserEdits !== undefined &&
      action !== FillScriptActionTypes.fill_by_opid
    ) {
      return Promise.resolve();
    }

    const delayActionsInMilliseconds = this.fastBulkProfileFill ? 1 : 20;
    return new Promise((resolve) =>
      setTimeout(async () => {
        try {
          if (preserveUserEdits !== undefined) {
            if (action === FillScriptActionTypes.fill_by_opid && value?.length) {
              const element = this.collectAutofillContentService.getAutofillFieldElementByOpid(opid);
              if (element && elementIsAriaComboboxElement(element)) {
                await this.fillAriaCombobox(element, value, preserveUserEdits, showAnimations);
              } else {
                this.insertValueIntoField(element, value, preserveUserEdits, showAnimations);
              }
            }
            resolve();
            return;
          }

          if (action === FillScriptActionTypes.fill_by_opid && !!value?.length) {
            await this.autofillInsertActions.fill_by_opid({ opid, value }, showAnimations);
          } else if (action === FillScriptActionTypes.click_on_opid) {
            this.autofillInsertActions.click_on_opid({ opid });
          } else if (action === FillScriptActionTypes.focus_by_opid) {
            this.autofillInsertActions.focus_by_opid({ opid });
          }
        } finally {
          resolve();
        }
      }, delayActionsInMilliseconds),
    );
  };

  private async handleFillFieldByOpidAction(opid: string, value: string, showAnimations = true) {
    const element = this.collectAutofillContentService.getAutofillFieldElementByOpid(opid);
    if (element && elementIsAriaComboboxElement(element)) {
      await this.fillAriaCombobox(element, value, undefined, showAnimations);
      return;
    }
    this.insertValueIntoField(element, value, undefined, showAnimations);
  }

  private handleClickOnFieldByOpidAction(opid: string) {
    const element = this.collectAutofillContentService.getAutofillFieldElementByOpid(opid);

    if (element) {
      this.triggerClickOnElement(element);
    }
  }

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

  private isDisabledOrAriaReadonly(element: HTMLElement): boolean {
    return (
      getAttributeBoolean(element, "disabled") ||
      getAttributeBoolean(element, "aria-disabled", true) ||
      getAttributeBoolean(element, "aria-readonly", true)
    );
  }

  private getProfileFieldValue(element: FormFieldElement): string | boolean {
    if (elementIsInputElement(element) && ["checkbox", "radio"].includes(element.type)) {
      return element.checked;
    }
    if (!elementIsFillableFormField(element) && elementIsAriaComboboxElement(element)) {
      const attrVal = element.getAttribute("value");
      if (attrVal !== null) {
        return attrVal;
      }
      const text = (element.textContent || element.innerText || "").replace(/\s+/g, " ").trim();
      if (
        !text ||
        element.hasAttribute("data-placeholder") ||
        element.querySelector("[data-placeholder]") !== null ||
        element.getAttribute("data-state") === "placeholder" ||
        /^(?:select|choose|pick|--|—|選択|選んで|선택|选择|請選擇|chọn|sélectionner|wählen|seleccionar|selecione)\b/i.test(
          text,
        )
      ) {
        return "";
      }
      return text;
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
      const radios = (
        element.getRootNode() as Document | ShadowRoot
      ).querySelectorAll<HTMLInputElement>('input[type="radio"]');
      for (const radio of radios) {
        if (radio.name !== element.name || radio.form !== element.form) {
          continue;
        }
        const previousRadioValue = this.profileValues.get(radio);
        if (
          (previousRadioValue !== undefined && previousRadioValue !== radio.checked) ||
          (radio.checked && previousRadioValue !== true)
        ) {
          return false;
        }
      }
    }
    return true;
  }

  private resolveSelectOptionValue(element: HTMLSelectElement, rawValue: string): string | null {
    const options = Array.from(element.options);
    const exactValue = options.find((opt) => !opt.disabled && opt.value === rawValue);
    if (exactValue) {
      return exactValue.value;
    }
    const exactText = options.find(
      (opt) => !opt.disabled && (opt.text === rawValue || opt.label === rawValue),
    );
    if (exactText) {
      return exactText.value;
    }
    const resolved = resolveSelectOption(
      options.map((opt) => ({
        value: opt.value,
        text: opt.text || opt.label,
        disabled: opt.disabled,
      })),
      rawValue,
    );
    return resolved ? resolved.value : null;
  }

  private shouldCheckRadioElement(element: HTMLInputElement, value: string): boolean {
    const optionLabel =
      this.collectAutofillContentService?.getRadioOptionLabel?.(element) ??
      getRadioOptionLabel(element);
    const hasExplicitValue = element.hasAttribute("value");

    if (!hasExplicitValue && !optionLabel) {
      return AFFIRMATIVE_TOGGLE_VALUES.has(String(value).toLowerCase());
    }

    const rawGroup =
      this.collectAutofillContentService?.getRadioGroupCandidates?.(element) ??
      getRadioGroupCandidates(element);
    return matchesRadioOption(
      {
        value: element.getAttribute("value") ?? element.value ?? "",
        label: optionLabel,
      },
      value,
      rawGroup.map((item) => ({ value: item.value, label: item.label })),
    );
  }

  /**
   * Opens a custom ARIA combobox / listbox trigger, filters if backed by an editable `<input>`,
   * locates visible `[role="option"]` candidates, resolves via `option-equivalence`, and clicks
   * the matching option cleanly.
   */
  public async fillAriaCombobox(
    element: HTMLElement,
    value: string,
    preserveUserEdits?: boolean,
    showAnimations = true,
  ): Promise<boolean> {
    if (!element || !value || this.isDisabledOrAriaReadonly(element)) {
      return false;
    }
    if (preserveUserEdits && !this.canFillProfileField(element)) {
      return false;
    }

    this.dispatchPointerOpenSequence(element);
    if (element.getAttribute("aria-expanded") !== "true") {
      element.dispatchEvent(
        new KeyboardEvent(EVENTS.KEYDOWN, {
          key: "ArrowDown",
          code: "ArrowDown",
          bubbles: true,
          composed: true,
        }),
      );
    }

    await Promise.resolve();

    let matchedOption = this.findMatchingAriaOption(element, value);

    if (!matchedOption && element instanceof HTMLInputElement && !element.readOnly) {
      this.setNativeInputValue(element, value);
      this.dispatchInputEventOnly(element, value);
      await Promise.resolve();
      matchedOption = this.findMatchingAriaOption(element, value);
    }

    if (!matchedOption) {
      await new Promise<void>((resolve) => setTimeout(resolve, 16));
      matchedOption = this.findMatchingAriaOption(element, value);
    }

    if (matchedOption) {
      this.dispatchPointerOpenSequence(matchedOption);
      this.simulateInputElementChangedEvent(element);
      if (preserveUserEdits !== undefined) {
        this.profileValues.set(element, this.getProfileFieldValue(element));
      }
      this.triggerFillAnimationOnElement(element, showAnimations);
      return true;
    }

    if (element instanceof HTMLInputElement && !element.readOnly && element.value === value) {
      this.simulateInputElementChangedEvent(element);
      if (preserveUserEdits !== undefined) {
        this.profileValues.set(element, this.getProfileFieldValue(element));
      }
      this.triggerFillAnimationOnElement(element, showAnimations);
      return true;
    }

    return false;
  }

  private findMatchingAriaOption(combobox: HTMLElement, desired: string): HTMLElement | null {
    const optionElements = this.collectVisibleAriaOptions(combobox);
    if (optionElements.length === 0) {
      return null;
    }
    const candidates = optionElements.map((optEl, idx) => {
      const dataValue =
        optEl.getAttribute("data-value") ??
        optEl.getAttribute("value") ??
        optEl.textContent?.replace(/\s+/g, " ").trim() ??
        String(idx);
      const text =
        optEl.getAttribute("aria-label")?.replace(/\s+/g, " ").trim() ||
        optEl.textContent?.replace(/\s+/g, " ").trim() ||
        dataValue;
      const disabled =
        optEl.hasAttribute("disabled") ||
        optEl.getAttribute("aria-disabled") === "true" ||
        optEl.hasAttribute("data-disabled");
      return {
        element: optEl,
        key: `${idx}:${dataValue}`,
        value: dataValue,
        text,
        disabled,
      };
    });

    const resolved = resolveSelectOption(
      candidates.map((c) => ({ value: c.value, text: c.text, disabled: c.disabled })),
      desired,
    );
    if (!resolved) {
      return null;
    }
    const match = candidates.find(
      (c) => !c.disabled && c.value === resolved.value && c.text === resolved.text,
    );
    return match?.element ?? null;
  }

  private collectVisibleAriaOptions(combobox: HTMLElement): HTMLElement[] {
    const roots: Array<Document | ShadowRoot | Element> = [];
    const rootNode = combobox.getRootNode() as Document | ShadowRoot;
    const controlledIds = [
      combobox.getAttribute("aria-controls"),
      combobox.getAttribute("aria-owns"),
    ]
      .filter((v): v is string => Boolean(v?.trim()))
      .flatMap((v) => v.trim().split(/\s+/));

    for (const id of controlledIds) {
      const target =
        ("getElementById" in rootNode && typeof rootNode.getElementById === "function"
          ? rootNode.getElementById(id)
          : null) ?? globalThis.document.getElementById(id);
      if (target) {
        roots.push(target);
      }
    }

    if (roots.length === 0) {
      roots.push(rootNode);
      if (rootNode !== globalThis.document) {
        roots.push(globalThis.document);
      }
    }

    const seen = new Set<HTMLElement>();
    const options: HTMLElement[] = [];
    for (const scope of roots) {
      const found = scope.querySelectorAll<HTMLElement>(
        '[role="listbox"] [role="option"], [role="option"]',
      );
      for (const el of found) {
        if (seen.has(el)) {
          continue;
        }
        if (
          el.getAttribute("aria-hidden") === "true" ||
          el.hidden ||
          this.domElementVisibilityService.isElementHiddenByCss(el)
        ) {
          continue;
        }
        seen.add(el);
        options.push(el);
      }
    }
    return options;
  }

  private dispatchPointerOpenSequence(target: HTMLElement): void {
    const EventCtor = typeof PointerEvent !== "undefined" ? PointerEvent : MouseEvent;
    target.dispatchEvent(new EventCtor("pointerdown", { bubbles: true, composed: true }));
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true }));
    this.triggerFocusOnElement(target, false);
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, composed: true }));
    this.triggerClickOnElement(target);
  }

  private setNativeInputValue(
    element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
    value: string,
  ): void {
    const previousValue = element.value;
    let proto = Object.getPrototypeOf(element);
    let setter: ((v: string) => void) | undefined;
    while (proto && !setter) {
      setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      proto = Object.getPrototypeOf(proto);
    }
    if (setter) {
      setter.call(element, value);
    } else {
      element.value = value;
    }
    (element as HTMLInputElement & { _valueTracker?: { setValue(v: string): void } })._valueTracker?.setValue(
      previousValue,
    );
  }

  private insertValueIntoField(
    element: FormFieldElement | null,
    value: string,
    preserveUserEdits?: boolean,
    showAnimations = true,
  ) {
    if (!element || !value) {
      return;
    }

    if (element instanceof HTMLSelectElement) {
      const resolvedValue = this.resolveSelectOptionValue(element, value);
      if (resolvedValue == null) {
        return;
      }
      value = resolvedValue;
    }

    if (elementIsInputElement(element) && element.type === "radio") {
      if (isReadonlyOrDisabledFormFieldElement(element)) {
        return;
      }
      if (!this.shouldCheckRadioElement(element, value)) {
        return;
      }
      if (element.checked) {
        return;
      }
      this.handleInsertValueAndTriggerSimulatedEvents(
        element,
        () => {
          if (preserveUserEdits !== undefined) {
            this.triggerClickOnElement(element);
          }
          element.checked = true;
        },
        preserveUserEdits,
        showAnimations,
      );
      return;
    }

    const isProfileCheckbox =
      preserveUserEdits !== undefined &&
      elementIsInputElement(element) &&
      element.type === "checkbox";
    const elementValue = (element as HTMLInputElement)?.value || element?.innerText || "";
    const elementAlreadyHasTheValue =
      !isProfileCheckbox && !!(elementValue?.length && elementValue === value);

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

    if (isProfileCheckbox) {
      this.handleInsertValueAndTriggerSimulatedEvents(
        element,
        () => (element.checked = AFFIRMATIVE_TOGGLE_VALUES.has(value.toLowerCase())),
        preserveUserEdits,
        showAnimations,
      );
      return;
    }

    const isFillableCheckboxElement =
      elementIsInputElement(element) &&
      element.type === "checkbox" &&
      AFFIRMATIVE_TOGGLE_VALUES.has(String(value).toLowerCase());
    if (isFillableCheckboxElement) {
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
      () => this.setNativeInputValue(element, value),
      preserveUserEdits,
      showAnimations,
    );
  }

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
      preserveUserEdits !== undefined &&
      elementIsInputElement(element) &&
      element.type === "radio" &&
      element.name
        ? Array.from(
            (element.getRootNode() as Document | ShadowRoot).querySelectorAll<HTMLInputElement>(
              'input[type="radio"]',
            ),
          ).filter(
            (radio) =>
              radio.name === element.name &&
              radio.form === element.form &&
              this.profileValues.has(radio),
          )
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

  private triggerPreInsertEventsOnElement(element: FormFieldElement): void {
    const initialElementValue = "value" in element ? element.value : "";

    this.simulateUserMouseClickAndFocusEventInteractions(element);
    this.simulateUserKeyboardEventInteractions(element);

    if ("value" in element && initialElementValue !== element.value) {
      element.value = initialElementValue;
    }
  }

  private triggerPostInsertEventsOnElement(element: FormFieldElement): void {
    const autofilledValue = "value" in element ? element.value : "";
    this.simulateUserKeyboardEventInteractions(element);

    if ("value" in element && autofilledValue !== element.value) {
      element.value = autofilledValue;
    }

    this.simulateInputElementChangedEvent(element);
  }

  private triggerFillAnimationOnElement(
    element: FormFieldElement,
    showAnimations = true,
  ): void {
    if (!showAnimations) {
      return;
    }

    const isCloseCall = this.currentStepIsCloseCall;
    const durationMs = this.currentAnimationDurationMs;
    const canAnimateElement =
      isCloseCall ||
      (elementIsInputElement(element) &&
        new Set(["email", "text", "password", "number", "tel", "url", "date"]).has(element.type)) ||
      elementIsAriaComboboxElement(element) ||
      elementIsSpanElement(element);

    if (this.domElementVisibilityService.isElementHiddenByCss(element) || !canAnimateElement) {
      return;
    }

    const cssClass = isCloseCall
      ? "com-vowkey-browser-close-call-fill"
      : "com-vowkey-browser-animated-fill";
    element.classList.add(cssClass);
    setTimeout(() => element.classList.remove(cssClass), isCloseCall ? Math.max(durationMs, 2400) : durationMs);
  }

  private showFillSummaryPill(summary: VowkeyFillSummary): void {
    try {
      if (!globalThis.document?.body) {
        return;
      }
      const existing = globalThis.document.getElementById("vowkey-fill-summary-host");
      existing?.remove();

      const host = globalThis.document.createElement("div");
      host.id = "vowkey-fill-summary-host";
      host.setAttribute("aria-live", "polite");
      const shadow = host.attachShadow({ mode: "closed" });

      const style = globalThis.document.createElement("style");
      style.textContent = `
        .pill {
          position: fixed;
          top: 16px;
          right: 16px;
          z-index: 2147483646;
          pointer-events: none;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          border-radius: 10px;
          background: #ffffff;
          color: #18181b;
          border: 1px solid rgba(24, 24, 27, 0.12);
          box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
          font: 500 13px/18px -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
        }
        .dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: #1d4ed8;
          flex-shrink: 0;
        }
        .missing {
          color: #b45309;
          font-weight: 500;
          padding-left: 8px;
          border-left: 1px solid rgba(24, 24, 27, 0.12);
        }
        @media (prefers-color-scheme: dark) {
          .pill {
            background: #18181b;
            color: #f4f4f5;
            border-color: rgba(244, 244, 245, 0.16);
          }
          .dot {
            background: #3b82f6;
          }
          .missing {
            color: #fbbf24;
            border-left-color: rgba(244, 244, 245, 0.16);
          }
        }
      `;

      const pill = globalThis.document.createElement("div");
      pill.className = "pill";

      const dot = globalThis.document.createElement("span");
      dot.className = "dot";
      pill.appendChild(dot);

      const primary = globalThis.document.createElement("span");
      primary.textContent =
        summary.summaryText ||
        (summary.filledCount === 1 ? "Filled 1 field" : `Filled ${summary.filledCount} fields`);
      pill.appendChild(primary);

      if (summary.missingCount > 0) {
        const missing = globalThis.document.createElement("span");
        missing.className = "missing";
        missing.textContent =
          summary.missingText ||
          (summary.missingCount === 1
            ? "1 needs your input"
            : `${summary.missingCount} need your input`);
        pill.appendChild(missing);
      }

      shadow.append(style, pill);
      globalThis.document.body.appendChild(host);
      setTimeout(() => host.remove(), 3500);
    } catch {
      // Never block form fill if page CSP or DOM environment rejects custom overlay nodes.
    }
  }

  private triggerClickOnElement(element?: HTMLElement): void {
    if (!element || typeof element.click !== TYPE_CHECK.FUNCTION) {
      return;
    }

    element.click();
  }

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

  private simulateUserMouseClickAndFocusEventInteractions(
    element: FormFieldElement,
    shouldResetValue = false,
  ): void {
    this.triggerClickOnElement(element);
    this.triggerFocusOnElement(element, shouldResetValue);
  }

  private simulateUserKeyboardEventInteractions(element: FormFieldElement): void {
    const simulatedKeyboardEvents = [EVENTS.KEYDOWN, EVENTS.KEYUP];
    for (let index = 0; index < simulatedKeyboardEvents.length; index++) {
      element.dispatchEvent(
        new KeyboardEvent(simulatedKeyboardEvents[index], { bubbles: true, composed: true }),
      );
    }
  }

  private dispatchInputEventOnly(element: FormFieldElement, data?: string): void {
    const nextData = data ?? ("value" in element ? String(element.value ?? "") : "");
    if (typeof InputEvent !== "undefined") {
      element.dispatchEvent(
        new InputEvent(EVENTS.INPUT, {
          bubbles: true,
          composed: true,
          data: nextData,
          inputType: "insertReplacementText",
        }),
      );
    } else {
      element.dispatchEvent(new Event(EVENTS.INPUT, { bubbles: true, composed: true }));
    }
  }

  private simulateInputElementChangedEvent(element: FormFieldElement): void {
    this.dispatchInputEventOnly(element);
    element.dispatchEvent(new Event(EVENTS.CHANGE, { bubbles: true, composed: true }));
    if (typeof FocusEvent !== "undefined") {
      element.dispatchEvent(new FocusEvent(EVENTS.BLUR, { bubbles: false, composed: true }));
      element.dispatchEvent(new FocusEvent("focusout", { bubbles: true, composed: true }));
    } else {
      element.dispatchEvent(new Event(EVENTS.BLUR, { bubbles: false, composed: true }));
      element.dispatchEvent(new Event("focusout", { bubbles: true, composed: true }));
    }
  }
}

export default InsertAutofillContentService;
