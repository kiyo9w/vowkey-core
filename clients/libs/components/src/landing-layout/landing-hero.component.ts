import { ChangeDetectionStrategy, Component, computed, input } from "@angular/core";

import { BitSvg, VowkeyIcon } from "@vowkey/assets/svg";

import { SvgModule } from "../svg";
import { TypographyModule } from "../typography";

import { LANDING_HERO_TEXT_ALIGNMENT_DEFAULT } from "./landing-defaults";

export type HeroTextAlignmentType = "left" | "center";

@Component({
  selector: "bit-landing-hero",
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./landing-hero.component.html",
  imports: [SvgModule, TypographyModule],
})
export class LandingHeroComponent {
  readonly icon = input<BitSvg | null>(null);
  readonly title = input<string | undefined>();
  readonly subtitle = input<string | undefined>();

  readonly heroTextAlignment = input<HeroTextAlignmentType>(LANDING_HERO_TEXT_ALIGNMENT_DEFAULT);

  protected readonly brandEmblem = VowkeyIcon;

  protected readonly alignmentClasses = computed(() =>
    this.heroTextAlignment() === "left" ? "tw-text-left" : "tw-text-center tw-mx-auto",
  );
}
