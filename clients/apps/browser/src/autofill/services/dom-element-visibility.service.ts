import { AutofillInlineMenuContentService } from "../overlay/inline-menu/abstractions/autofill-inline-menu-content.service";
import { FillableFormFieldElement, FormFieldElement } from "../types";

import { DomElementVisibilityService as DomElementVisibilityServiceInterface } from "./abstractions/dom-element-visibility.service";

class DomElementVisibilityService implements DomElementVisibilityServiceInterface {
  private cachedComputedStyle: CSSStyleDeclaration | null = null;

  constructor(private inlineMenuContentService?: AutofillInlineMenuContentService) {}

  /**
   * Checks if an element is viewable. This is done by checking if the element is within the
   * viewport bounds, not hidden by CSS, and not hidden behind another element.
   * @param element
   */
  async isElementViewable(element: HTMLElement): Promise<boolean> {
    const elementBoundingClientRect = element.getBoundingClientRect();
    if (
      this.isElementOutsideViewportBounds(element, elementBoundingClientRect) ||
      this.isElementHiddenByCss(element)
    ) {
      return false;
    }

    return this.formFieldIsNotHiddenBehindAnotherElement(element, elementBoundingClientRect);
  }

  /**
   * Check if the target element is hidden using CSS. This is done by checking the opacity, display,
   * visibility, and clip-path CSS properties of the element. We also check the opacity of all
   * parent elements to ensure that the target element is not hidden by a parent element.
   * @param {HTMLElement} element
   * @returns {boolean}
   * @public
   */
  isElementHiddenByCss(element: HTMLElement): boolean {
    this.cachedComputedStyle = null;

    if (
      this.isElementInvisible(element) ||
      this.isElementNotDisplayed(element) ||
      this.isElementNotVisible(element) ||
      this.isElementClipped(element)
    ) {
      return true;
    }

    let parentElement = element.parentElement;
    while (parentElement && parentElement !== element.ownerDocument.documentElement) {
      this.cachedComputedStyle = null;
      if (this.isElementInvisible(parentElement)) {
        return true;
      }

      parentElement = parentElement.parentElement;
    }

    return false;
  }

  /**
   * Gets the computed style of a given element, will only calculate the computed
   * style if the element's style has not been previously cached.
   * @param {HTMLElement} element
   * @param {string} styleProperty
   * @returns {string}
   * @private
   */
  private getElementStyle(element: HTMLElement, styleProperty: string): string {
    if (!this.cachedComputedStyle) {
      this.cachedComputedStyle = (element.ownerDocument.defaultView || globalThis).getComputedStyle(
        element,
      );
    }

    return this.cachedComputedStyle.getPropertyValue(styleProperty);
  }

  /**
   * Checks if the opacity of the target element is less than 0.1.
   * @param {HTMLElement} element
   * @returns {boolean}
   * @private
   */
  private isElementInvisible(element: HTMLElement): boolean {
    return parseFloat(this.getElementStyle(element, "opacity")) < 0.1;
  }

  /**
   * Checks if the target element has a display property of none.
   * @param {HTMLElement} element
   * @returns {boolean}
   * @private
   */
  private isElementNotDisplayed(element: HTMLElement): boolean {
    return this.getElementStyle(element, "display") === "none";
  }

  /**
   * Checks if the target element has a visibility property of hidden or collapse.
   * @param {HTMLElement} element
   * @returns {boolean}
   * @private
   */
  private isElementNotVisible(element: HTMLElement): boolean {
    return new Set(["hidden", "collapse"]).has(this.getElementStyle(element, "visibility"));
  }

  /**
   * Checks if the target element has a clip-path property that hides the element.
   * @param {HTMLElement} element
   * @returns {boolean}
   * @private
   */
  private isElementClipped(element: HTMLElement): boolean {
    return new Set([
      "inset(50%)",
      "inset(100%)",
      "circle(0)",
      "circle(0px)",
      "circle(0px at 50% 50%)",
      "polygon(0 0, 0 0, 0 0, 0 0)",
      "polygon(0px 0px, 0px 0px, 0px 0px, 0px 0px)",
    ]).has(this.getElementStyle(element, "clipPath"));
  }

  /**
   * Checks if the target element is outside the viewport bounds. This is done by checking if the
   * element is too small or is overflowing the viewport bounds.
   *
   * `scrollWidth` and `scrollHeight` are integers while `getBoundingClientRect` can be
   * fractional. Round the rect edges to whole pixels before comparing so a fractional overrun
   * does not count as off-screen.
   *
   * @param {HTMLElement} targetElement
   * @param {DOMRectReadOnly | null} targetElementBoundingClientRect
   * @returns {boolean}
   * @private
   */
  private isElementOutsideViewportBounds(
    targetElement: HTMLElement,
    targetElementBoundingClientRect: DOMRectReadOnly | null = null,
  ): boolean {
    const documentElement = targetElement.ownerDocument.documentElement;
    const documentElementWidth = documentElement.scrollWidth;
    const documentElementHeight = documentElement.scrollHeight;
    const elementBoundingClientRect =
      targetElementBoundingClientRect || targetElement.getBoundingClientRect();
    const elementTopOffset = elementBoundingClientRect.top - documentElement.clientTop;
    const elementLeftOffset = elementBoundingClientRect.left - documentElement.clientLeft;

    const isElementSizeInsufficient =
      elementBoundingClientRect.width < 10 || elementBoundingClientRect.height < 10;
    const isElementOverflowingLeftViewport = Math.ceil(elementLeftOffset) < 0;
    const isElementOverflowingRightViewport =
      Math.floor(elementLeftOffset + elementBoundingClientRect.width) > documentElementWidth;
    const isElementOverflowingTopViewport = Math.ceil(elementTopOffset) < 0;
    const isElementOverflowingBottomViewport =
      Math.floor(elementTopOffset + elementBoundingClientRect.height) > documentElementHeight;

    return (
      isElementSizeInsufficient ||
      isElementOverflowingLeftViewport ||
      isElementOverflowingRightViewport ||
      isElementOverflowingTopViewport ||
      isElementOverflowingBottomViewport
    );
  }

  /**
   * Checks if a passed FormField is not hidden behind another element. This is done by
   * checking if the element at the center point of the FormField is the FormField itself
   * or one of its labels.
   * @param {FormFieldElement} targetElement
   * @param {DOMRectReadOnly | null} targetElementBoundingClientRect
   * @returns {boolean}
   * @private
   */
  private formFieldIsNotHiddenBehindAnotherElement(
    targetElement: FormFieldElement,
    targetElementBoundingClientRect: DOMRectReadOnly | null = null,
  ): boolean {
    const elementBoundingClientRect =
      targetElementBoundingClientRect || targetElement.getBoundingClientRect();
    const elementRootNode = targetElement.getRootNode();
    const rootElement =
      elementRootNode instanceof ShadowRoot ? elementRootNode : targetElement.ownerDocument;
    const elementAtCenterPoint = rootElement.elementFromPoint(
      elementBoundingClientRect.left + elementBoundingClientRect.width / 2,
      elementBoundingClientRect.top + elementBoundingClientRect.height / 2,
    );

    const view = targetElement.ownerDocument.defaultView;
    const centerY = elementBoundingClientRect.top + elementBoundingClientRect.height / 2;
    if (
      elementAtCenterPoint === targetElement ||
      (elementAtCenterPoint === null && view != null && centerY >= view.innerHeight)
    ) {
      return true;
    }

    if (this.inlineMenuContentService?.isElementInlineMenu(elementAtCenterPoint as HTMLElement)) {
      return true;
    }

    const targetElementLabelsSet = new Set((targetElement as FillableFormFieldElement).labels);
    if (targetElementLabelsSet.has(elementAtCenterPoint as HTMLLabelElement)) {
      return true;
    }

    const closestParentLabel = elementAtCenterPoint?.parentElement?.closest("label");
    if (closestParentLabel && targetElementLabelsSet.has(closestParentLabel)) {
      return true;
    }

    return this.isOccludedOnlyByDockedChromeBar(targetElement, elementAtCenterPoint);
  }

  /**
   * Returns true when a scrollable form control is only temporarily beneath a compact top/bottom
   * `position: fixed` or `position: sticky` chrome bar (header/footer) at the current scroll offset,
   * while continuing to reject modal backdrops and non-scrolling overlays.
   */
  private isOccludedOnlyByDockedChromeBar(
    targetElement: HTMLElement,
    hitElement: Element | null,
  ): boolean {
    if (!hitElement) {
      return false;
    }
    const doc = targetElement.ownerDocument;
    const view = doc.defaultView;
    if (!view || view.innerHeight <= 0 || doc.documentElement.scrollHeight <= view.innerHeight) {
      return false;
    }

    let targetAncestor: HTMLElement | null = targetElement;
    while (targetAncestor && targetAncestor !== doc.documentElement) {
      if (view.getComputedStyle(targetAncestor).position === "fixed") {
        return false;
      }
      targetAncestor = targetAncestor.parentElement;
    }

    let current: HTMLElement | null = hitElement as HTMLElement;
    while (current && current !== doc.documentElement) {
      if (!current.contains(targetElement)) {
        const position = view.getComputedStyle(current).position;
        if (position === "fixed" || position === "sticky") {
          const rect = current.getBoundingClientRect();
          const isCompactBar = rect.height > 0 && rect.height <= view.innerHeight * 0.25;
          const isDockedEdge = rect.top <= 4 || rect.bottom >= view.innerHeight - 4;
          if (isCompactBar && isDockedEdge) {
            return true;
          }
        }
      }
      current = current.parentElement;
    }

    return false;
  }
}

export default DomElementVisibilityService;
