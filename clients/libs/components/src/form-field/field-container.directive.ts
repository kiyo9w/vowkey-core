import { booleanAttribute, computed, Directive, input } from "@angular/core";

export type FieldContainerSize = "base" | "large";

@Directive({
  selector: "[bitFieldContainer]",
  host: { "[class]": "classes()" },
})
export class BitFieldContainerDirective {
  readonly size = input<FieldContainerSize>("base");
  readonly hasError = input(false, { transform: booleanAttribute });
  readonly readOnly = input(false, { transform: booleanAttribute });

  protected readonly classes = computed(() => {
    const size = this.size();
    const hasError = this.hasError();
    const readOnly = this.readOnly();

    return [
      "tw-group/form-field",
      "tw-flex",
      "tw-w-full",
      "tw-border",
      "tw-rounded-lg",
      "tw-border-solid",
      "tw-border-border-base",
      "tw-bg-bg-primary",
      "tw-placeholder-fg-body-subtle",
      "has-[:is(input,textarea):disabled]:tw-border-border-light",
      "has-[:is(input,textarea):disabled]:tw-bg-bg-secondary",
      "tw-transition-colors",
      "has-[:focus-visible]:tw-border-border-focus",
      "has-[.tw-test-focus-visible]:tw-border-border-focus",
      "has-[:focus-visible]:tw-ring-[var(--vk-selected)]",
      "has-[.tw-test-focus-visible]:tw-ring-[var(--vk-selected)]",
      "has-[:focus-visible]:tw-ring-[3px]",
      "has-[.tw-test-focus-visible]:tw-ring-[3px]",
      "tw-relative",
      "has-[select]:after:tw-pointer-events-none",
      "has-[select]:after:tw-absolute",
      // spacing here to match visual spacing used by ng-select arrow
      "has-[select]:after:tw-end-[calc(theme(spacing.3)_+_2px)]",
      "has-[select]:after:tw-top-[calc(50%_-_1px)]",
      "has-[select]:after:tw-rotate-[45deg]",
      "has-[select]:after:-tw-translate-y-1/2",
      "has-[select]:after:tw-size-2",
      "has-[select]:after:tw-border-fg-heading",
      "has-[select]:after:tw-border-r-[2px]",
      "has-[select]:after:tw-border-b-[2px]",
      "has-[select]:after:tw-rounded-[2px]",
      ...(size === "large" ? ["tw-text-base/6", "tw-min-h-12"] : ["tw-text-sm/5", "tw-min-h-10"]),
      ...(hasError
        ? [
            "!tw-ring-border-danger",
            "tw-ring-1",
            "!tw-border-border-danger",
            "has-[:focus-visible]:!tw-border-border-danger",
            "has-[.tw-test-focus-visible]:!tw-border-border-danger",
            "has-[:focus-visible]:!tw-ring-border-danger",
            "has-[.tw-test-focus-visible]:!tw-ring-border-danger",
          ]
        : []),
      ...(readOnly
        ? [
            "tw-bg-transparent",
            "tw-border-transparent",
            "has-[:focus-visible]:!tw-border-border-focus",
            "has-[.tw-test-focus-visible]:!tw-border-border-focus",
            "has-[:focus-visible]:!tw-ring-border-focus",
            "has-[.tw-test-focus-visible]:!tw-ring-border-focus",
          ]
        : [
            "[&:not(:has(:focus-visible)):not(:has(:is(input,textarea):disabled)):hover]:tw-border-border-strong",
            "[&:not(:has(:focus-visible)):not(:has(.tw-test-focus-visible)):not(:has(:is(input,textarea):disabled)).tw-test-hover]:tw-border-border-strong",
          ]),
    ].join(" ");
  });
}
