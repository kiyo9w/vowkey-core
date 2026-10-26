import {
  AfterContentInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChildren,
  input,
  output,
  signal,
} from "@angular/core";

import {
  AccordionComponent,
  BadgeComponent,
  VowkeyIcon,
  ButtonComponent,
  IconComponent,
} from "@vowkey/components";
import { I18nPipe } from "@vowkey/ui-common";

import { OnboardingTaskComponent } from "./onboarding-task.component";

@Component({
  selector: "app-onboarding",
  templateUrl: "./onboarding.component.html",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AccordionComponent, BadgeComponent, ButtonComponent, IconComponent, I18nPipe],
})
export class OnboardingComponent implements AfterContentInit {
  readonly tasks = contentChildren(OnboardingTaskComponent);
  readonly title = input.required<string>();
  readonly subtitle = input<string>();
  readonly startIcon = input<VowkeyIcon>();

  readonly dismiss = output<void>();

  protected readonly open = signal(true);

  protected readonly amountCompleted = computed(
    () => this.tasks().filter((task) => task.completed()).length,
  );

  ngAfterContentInit(): void {
    this.open.set(this.amountCompleted() <= 1);
  }
}
