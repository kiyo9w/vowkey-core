import { css } from "@emotion/css";
import { html } from "lit";

import { IconProps } from "../common-types";
import { buildIconColorRule, ruleNames, themes } from "../constants/styles";

/** Vowkey's mark. It keeps the name its callers use. */
export function Shield({ ariaHidden = true, color, theme }: IconProps) {
  const inkColor = color || themes[theme].text.main;

  return html`
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="14 20 92 72"
      fill="none"
      aria-hidden="${ariaHidden}"
    >
      <path
        class=${css(buildIconColorRule(inkColor, ruleNames.stroke))}
        d="M70 40H93a9 9 0 0 1 9 9v28a9 9 0 0 1-9 9H27a9 9 0 0 1-9-9V49a9 9 0 0 1 9-9h1"
        stroke-width="9"
        stroke-linecap="round"
      />
      <rect x="31" y="26" width="34" height="25" rx="5" fill="#2563EB" />
      <g class=${css(buildIconColorRule(inkColor, ruleNames.fill))}>
        <circle cx="35" cy="66" r="6" />
        <circle cx="51" cy="66" r="6" />
        <circle cx="67" cy="66" r="6" />
      </g>
      <rect x="80" y="53" width="7" height="24" rx="3.5" fill="#2563EB" />
    </svg>
  `;
}
