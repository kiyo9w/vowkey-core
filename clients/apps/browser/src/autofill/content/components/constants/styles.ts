import { Theme } from "@vowkey/common/platform/enums";

import { IconProps } from "../common-types";

const lightTheme = {
  transparent: {
    hover: `rgb(0 0 0 / 0.02)`,
  },
  shadow: `rgba(168 179 200)`,
  primary: {
    100: `rgba(230, 238, 254)`,
    300: `rgba(157, 187, 249)`,
    600: `rgba(37, 99, 235)`,
    700: `rgba(29, 78, 216)`,
  },
  secondary: {
    100: `rgba(236, 234, 228)`,
    300: `rgba(226, 224, 218)`,
    500: `rgba(111, 113, 122)`,
    600: `rgba(91, 93, 102)`,
    700: `rgba(60, 62, 70)`,
  },
  success: {
    100: `rgba(228, 244, 236)`,
    600: `rgba(18, 138, 90)`,
    700: `rgba(11, 98, 63)`,
  },
  danger: {
    100: `rgba(253, 236, 234)`,
    600: `rgba(194, 53, 43)`,
    700: `rgba(150, 38, 30)`,
  },
  warning: {
    100: `rgba(251, 240, 222)`,
    600: `rgba(166, 95, 12)`,
    700: `rgba(120, 66, 6)`,
  },
  info: {
    100: `rgba(230, 238, 254)`,
    600: `rgba(37, 99, 235)`,
    700: `rgba(29, 78, 216)`,
  },
  art: {
    primary: `rgba(2, 15, 102)`,
    accent: `rgba(44, 221, 223)`,
  },
  text: {
    main: `rgba(24, 24, 27)`,
    muted: `rgba(110, 110, 119)`,
    contrast: `rgba(255, 255, 255)`,
    alt2: `rgba(255, 255, 255)`,
    code: `rgba(166, 95, 12)`,
  },
  background: {
    DEFAULT: `rgba(250, 249, 246)`,
    alt: `rgba(242, 241, 236)`,
    alt2: `rgba(24, 24, 27)`,
    alt3: `rgba(38, 40, 46)`,
    alt4: `rgba(24, 24, 27)`,
  },
  brandLogo: `rgba(37, 99, 235)`,
  passwordSpecial: `rgba(184, 0, 23)`,
  passwordNumber: `rgba(20, 82, 193)`,
};

const darkTheme = {
  transparent: {
    hover: `rgb(255 255 255 / 0.02)`,
  },
  shadow: `rgba(0, 0, 0)`,
  primary: {
    100: `rgba(26, 38, 68)`,
    300: `rgba(47, 82, 166)`,
    600: `rgba(91, 141, 248)`,
    700: `rgba(169, 195, 255)`,
  },
  secondary: {
    100: `rgba(34, 35, 41)`,
    300: `rgba(42, 44, 51)`,
    500: `rgba(110, 113, 123)`,
    600: `rgba(162, 165, 175)`,
    700: `rgba(190, 192, 201)`,
  },
  success: {
    100: `rgba(21, 48, 42)`,
    600: `rgba(63, 191, 138)`,
    700: `rgba(140, 224, 186)`,
  },
  danger: {
    100: `rgba(62, 28, 26)`,
    600: `rgba(229, 103, 93)`,
    700: `rgba(245, 168, 161)`,
  },
  warning: {
    100: `rgba(51, 39, 15)`,
    600: `rgba(226, 160, 74)`,
    700: `rgba(240, 196, 135)`,
  },
  info: {
    100: `rgba(26, 38, 68)`,
    600: `rgba(91, 141, 248)`,
    700: `rgba(169, 195, 255)`,
  },
  art: {
    primary: `rgba(243, 246, 249)`,
    accent: `rgba(44, 221, 233)`,
  },
  text: {
    main: `rgba(236, 237, 241)`,
    muted: `rgba(162, 165, 175)`,
    contrast: `rgba(16, 17, 21)`,
    alt2: `rgba(255, 255, 255)`,
    code: `rgba(226, 160, 74)`,
  },
  background: {
    DEFAULT: `rgba(31, 32, 39)`,
    alt: `rgba(16, 17, 21)`,
    alt2: `rgba(31, 32, 39)`,
    alt3: `rgba(42, 44, 51)`,
    alt4: `rgba(16, 17, 21)`,
  },
  brandLogo: `rgba(236, 237, 241)`,
  passwordSpecial: `rgba(255, 141, 133)`,
  passwordNumber: `rgba(111, 157, 241)`,
};

export const themes = {
  light: lightTheme,
  dark: darkTheme,

  // For compatibility
  system: lightTheme,
};

export const spacing = {
  4: `16px`,
  3: `12px`,
  2: `8px`,
  "1.5": `6px`,
  1: `4px`,
};

export const border = {
  radius: {
    md: `8px`,
    large: `10px`,
    full: `9999px`,
  },
};

export const typography = {
  body1: `
    line-height: 24px;
    font-family: "Be Vietnam Pro", "Noto Sans JP Variable", system-ui, sans-serif;
    font-size: 16px;
  `,
  body2: `
    line-height: 20px;
    font-family: "Be Vietnam Pro", "Noto Sans JP Variable", system-ui, sans-serif;
    font-size: 14px;
  `,
  helperMedium: `
    line-height: 16px;
    font-family: "Be Vietnam Pro", "Noto Sans JP Variable", system-ui, sans-serif;
    font-size: 12px;
  `,
};

export const ruleNames = {
  fill: "fill",
  stroke: "stroke",
} as const;

type RuleName = (typeof ruleNames)[keyof typeof ruleNames];

/*
 * `color` is an intentionally generic name here, since either fill or stroke may apply, due to
 * inconsistent SVG construction. This consequently precludes dynamic multi-colored icons here.
 */
export const buildIconColorRule = (color: string, rule: RuleName = ruleNames.fill) => `
  ${rule}: ${color};
`;

export const resolveIconColor = ({ color, disabled, theme }: IconProps) =>
  disabled ? themes[theme].secondary["300"] : color || themes[theme].text.main;

export const animations = {
  spin: `
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(359deg);
    }
  `,
};

export function scrollbarStyles(theme: Theme, color?: { thumb?: string; track?: string }) {
  const thumbColor = color?.thumb || themes[theme].secondary["500"];
  const trackColor = color?.track || themes[theme].background.alt;

  return {
    /* FireFox & Chrome support */
    default: `
      scrollbar-color: ${thumbColor} ${trackColor};
    `,
    /* Safari Support */
    safari: `
      ::-webkit-scrollbar {
        overflow: auto;
      }
      ::-webkit-scrollbar-thumb {
        border-width: 4px;
        border-style: solid;
        border-radius: 0.5rem;
        border-color: transparent;
        background-clip: content-box;
        background-color: ${thumbColor};
      }
      ::-webkit-scrollbar-track {
        ${trackColor};
      }
      ::-webkit-scrollbar-thumb:hover {
        ${themes[theme].secondary["600"]};
      }
    `,
  };
}
