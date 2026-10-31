import { css } from "@emotion/css";
import { html, nothing } from "lit";

import { Theme } from "@vowkey/common/platform/enums";

import { InlineMenuCipherData } from "../../../background/abstractions/overlay.background";
import { spacing, themes, typography } from "../constants/styles";
import { Passkey } from "../icons";

export type CipherDetailsProps = {
  cipher: InlineMenuCipherData;
  theme: Theme;
  notSavedYetText?: string;
};

export function CipherDetails({ cipher, theme, notSavedYetText = "" }: CipherDetailsProps) {
  const passkey = cipher.login?.passkey;
  const name = html`
    <span title=${cipher.name} class=${primaryTextStyles(theme)}>${cipher.name}</span>
  `;

  if (cipher.identity?.field !== undefined) {
    const field = cipher.identity.field;
    const value = field ? (cipher.reprompt ? "●●●●●●" : field.value) : notSavedYetText;
    const context = field?.label ? `${field.label} · ${cipher.name}` : cipher.name;
    return html`
      <div>
        <span title=${value} class=${primaryTextStyles(theme)}>${value}</span>
        <span title=${context} class=${secondaryTextStyles(theme)}>${context}</span>
      </div>
    `;
  }

  if (passkey) {
    const showRpName = cipher.name !== passkey.rpName;
    const secondary = cipher.login?.username || passkey.userName;
    const firstLine = showRpName ? passkey.rpName : secondary;
    const secondLine = showRpName ? secondary : undefined;

    return html`
      <div>
        ${name}
        ${
          firstLine
            ? html`<span title=${firstLine} class=${passkeySubtitleStyles(theme)}>
                ${Passkey({ theme, color: themes[theme].text.muted })} ${firstLine}
              </span>`
            : nothing
        }
        ${
          secondLine
            ? html`<span title=${secondLine} class=${passkeySubtitleStyles(theme)}
                >${secondLine}</span
              >`
            : nothing
        }
      </div>
    `;
  }

  const subtitle =
    cipher.identity?.username ||
    cipher.identity?.fullName ||
    cipher.login?.username ||
    cipher.card ||
    "";

  return html`
    <div>
      ${name}
      ${
        subtitle
          ? html`<span title=${subtitle} class=${secondaryTextStyles(theme)}>${subtitle}</span>`
          : nothing
      }
    </div>
  `;
}

const primaryTextStyles = (theme: Theme) => css`
  ${typography.body2}

  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: ${themes[theme].text.main};
  font-weight: 500;
`;

const secondaryTextStyles = (theme: Theme) => css`
  ${typography.helperMedium}

  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: ${themes[theme].text.muted};
`;

const passkeySubtitleStyles = (theme: Theme) => css`
  ${typography.helperMedium}

  display: flex;
  align-items: center;
  gap: ${spacing["1"]};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: ${themes[theme].text.muted};

  > svg {
    flex-shrink: 0;
    width: ${spacing["3"]};
    height: ${spacing["3"]};
  }
`;
