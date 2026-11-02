import { css } from "@emotion/css";
import { html, nothing } from "lit";

import { Theme } from "@vowkey/common/platform/enums";

import { InlineMenuCipherData } from "../../../background/abstractions/overlay.background";
import { EventSecurity } from "../../../utils/event-security";
import { CipherIcon } from "../cipher/cipher-icon";
import { spacing, themes, typography } from "../constants/styles";
import { ExternalLink } from "../icons";

import { CipherDetails } from "./cipher-details";
import { TotpCipherInfo } from "./totp-cipher-info";
import { TotpCountdown } from "./totp-countdown";

const CIPHER_ITEM_SELECTOR = "[data-cipher-item]";
const CIPHER_CONTENT_SELECTOR = "[data-cipher-content]";
const FILL_CIPHER_SELECTOR =
  "[data-fill-cipher]:not(:disabled), [data-profile-form], [data-profile-choose-detail], [data-profile-detail]";

export type InlineMenuCipherItemProps = {
  cipher: InlineMenuCipherData;
  theme: Theme;
  viewButtonText: string;
  opensInANewWindowText: string;
  fillCredentialsForText: string;
  logInWithPasskeyAriaLabel: string;
  handleFillCipher: (
    e: Event,
    profileFillScope?: "field" | "form",
    profileDetail?: string,
  ) => void;
  handleViewCipher: (e: Event) => void;
  bordered?: boolean;
  usernameText?: string;
  fillText?: string;
  fillWholeFormText?: string;
  chooseDetailText?: string;
  searchDetailsText?: string;
  notSavedYetText?: string;
  cardNumberEndsWithText?: string;
  fillVerificationCodeText?: string;
  totpCodeAria?: string;
  showTotpUsername?: boolean;
  totpSecondsRemaining?: number;
  onTotpPeriodElapsed?: () => void;
  onListEdgeReached?: (direction: 1 | -1) => void;
};

export function InlineMenuCipherItem({
  cipher,
  theme,
  viewButtonText,
  opensInANewWindowText,
  fillCredentialsForText,
  logInWithPasskeyAriaLabel,
  handleFillCipher,
  handleViewCipher,
  bordered = true,
  usernameText,
  fillText = "",
  fillWholeFormText = "",
  chooseDetailText = "Choose detail",
  searchDetailsText = "Search details",
  notSavedYetText = "",
  cardNumberEndsWithText,
  fillVerificationCodeText,
  totpCodeAria,
  showTotpUsername = false,
  totpSecondsRemaining,
  onTotpPeriodElapsed,
  onListEdgeReached,
}: InlineMenuCipherItemProps) {
  const isTotp = !!(cipher.login?.totpField && cipher.login?.totp);
  const period = cipher.login?.totpCodeTimeInterval ?? 30;
  const field = cipher.identity?.field;
  const isProfile = field !== undefined;
  const profileDetails = !cipher.reprompt ? (cipher.identity?.details ?? []) : [];
  const fieldValue = field ? (cipher.reprompt ? "●●●●●●" : field.value) : notSavedYetText;
  const fillPrefix = cipher.login?.passkey ? logInWithPasskeyAriaLabel : fillCredentialsForText;
  const fillLabel = isProfile
    ? field
      ? `${fillText} ${field.label ? `${field.label}: ` : ""}${fieldValue}, ${cipher.name}`
      : `${notSavedYetText}, ${cipher.name}`
    : `${fillPrefix} ${cipher.name}`;
  const fillDescription = getFillAriaDescription(cipher, usernameText, cardNumberEndsWithText);
  const viewButtonAria = `${viewButtonText} ${cipher.name}, ${opensInANewWindowText}`;
  const uri = (cipher.icon.imageEnabled && cipher.icon.image) || undefined;

  const onFillCipher = (event: Event) => {
    if (EventSecurity.isEventTrusted(event) && (!isProfile || field)) {
      handleFillCipher(event, isProfile ? "field" : undefined);
    }
  };

  const onFillForm = (event: Event) => {
    if (EventSecurity.isEventTrusted(event)) {
      handleFillCipher(event, "form");
    }
  };

  const onFillDetail = (detailKey: string) => (event: Event) => {
    if (EventSecurity.isEventTrusted(event)) {
      handleFillCipher(event, "field", detailKey);
    }
  };

  const onToggleDetails = (event: Event) => {
    if (!EventSecurity.isEventTrusted(event) || !(event.currentTarget instanceof HTMLElement)) {
      return;
    }
    event.stopPropagation();
    const button = event.currentTarget;
    const item = button.closest<HTMLElement>(CIPHER_ITEM_SELECTOR);
    const picker = item?.querySelector<HTMLElement>("[data-profile-detail-picker]");
    if (!picker) {
      return;
    }
    const nextOpen = picker.hidden;
    picker.hidden = !nextOpen;
    button.setAttribute("aria-expanded", String(nextOpen));
    if (nextOpen) {
      const search = picker.querySelector<HTMLInputElement>("[data-profile-detail-search]");
      if (search) {
        search.value = "";
        picker.querySelectorAll<HTMLElement>("[data-profile-detail-row]").forEach((row) => {
          row.hidden = false;
        });
        search.focus();
      } else {
        button.focus();
      }
    }
  };

  const onSearchDetails = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement | null;
    const picker = input?.closest<HTMLElement>("[data-profile-detail-picker]");
    if (!input || !picker) {
      return;
    }
    const query = input.value.trim().toLowerCase();
    picker.querySelectorAll<HTMLElement>("[data-profile-detail-row]").forEach((row) => {
      const text = (row.dataset.searchText ?? "").toLowerCase();
      row.hidden = query.length > 0 && !text.includes(query);
    });
  };

  const onSearchKeyDown = (event: KeyboardEvent) => {
    const input = event.currentTarget as HTMLInputElement | null;
    const item = input?.closest<HTMLElement>(CIPHER_ITEM_SELECTOR);
    const picker = input?.closest<HTMLElement>("[data-profile-detail-picker]");
    if (!item || !picker) {
      return;
    }
    if (event.code === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      picker.hidden = true;
      const chooseBtn = item.querySelector<HTMLElement>("[data-profile-choose-detail]");
      chooseBtn?.setAttribute("aria-expanded", "false");
      chooseBtn?.focus();
    } else if (event.code === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      const firstDetail = Array.from(
        picker.querySelectorAll<HTMLElement>("[data-profile-detail]"),
      ).find((el) => !el.closest("[hidden]"));
      firstDetail?.focus();
    }
  };

  const onViewCipher = (event: Event) => {
    if (EventSecurity.isEventTrusted(event)) {
      event.stopPropagation();
      handleViewCipher(event);
    }
  };

  const onFillKeyUp = (event: KeyboardEvent) => handleFillCipherKeyUp(event, onListEdgeReached);
  const onViewKeyUp = (event: KeyboardEvent) => handleViewCipherKeyUp(event, onListEdgeReached);

  return html`
    <div data-cipher-item role="listitem" class=${cipherItemStyles({ bordered, theme })}>
      <div data-cipher-content class=${cipherItemContentStyles(theme)}>
        <button
          type="button"
          data-fill-cipher
          ?data-profile-field=${isProfile}
          ?disabled=${isProfile && !field}
          tabindex="-1"
          class=${fillCipherButtonStyles}
          title=${fillLabel}
          aria-label=${fillLabel}
          aria-description=${fillDescription ?? nothing}
          @click=${onFillCipher}
          @keyup=${onFillKeyUp}
        >
          ${
            isTotp
              ? TotpCountdown({
                  theme,
                  period,
                  secondsRemaining: totpSecondsRemaining,
                  onPeriodElapsed: onTotpPeriodElapsed,
                })
              : CipherIcon({
                  color: themes[theme].primary["600"],
                  size: `calc(${spacing["4"]} + ${spacing["2"]})`,
                  theme,
                  uri,
                })
          }
          ${
            isTotp
              ? TotpCipherInfo({
                  theme,
                  heading: fillVerificationCodeText ?? "",
                  totp: cipher.login!.totp!,
                  totpCodeAria,
                  username: showTotpUsername ? cipher.login?.username : undefined,
                  masked: !!cipher.reprompt,
                })
              : CipherDetails({ theme, cipher, ...(isProfile ? { notSavedYetText } : {}) })
          }
        </button>
        <button
          type="button"
          data-view-cipher
          tabindex="-1"
          title=${viewButtonText}
          aria-label=${viewButtonAria}
          class=${viewCipherButtonStyles(theme)}
          @click=${onViewCipher}
          @keyup=${onViewKeyUp}
        >
          ${ExternalLink({ theme, color: themes[theme].primary["600"] })}
        </button>
      </div>
      ${
        isProfile
          ? html`
              <div data-cipher-content class=${`${cipherItemContentStyles(theme)} ${profileSecondaryRowStyles}`}>
                <button
                  type="button"
                  data-profile-form
                  tabindex="-1"
                  class=${`${fillCipherButtonStyles} ${profileFormButtonStyles(theme)}`}
                  aria-label=${`${fillWholeFormText}, ${cipher.name}`}
                  @click=${onFillForm}
                  @keyup=${onFillKeyUp}
                >
                  ${fillWholeFormText}
                </button>
                ${
                  profileDetails.length > 0
                    ? html`
                        <button
                          type="button"
                          data-profile-choose-detail
                          tabindex="-1"
                          aria-expanded="false"
                          aria-label=${`${chooseDetailText}, ${cipher.name}`}
                          class=${profileChooseDetailButtonStyles(theme)}
                          @click=${onToggleDetails}
                          @keyup=${onFillKeyUp}
                        >
                          ${chooseDetailText}
                        </button>
                      `
                    : nothing
                }
              </div>
              ${
                profileDetails.length > 0
                  ? html`
                      <div data-profile-detail-picker hidden class=${profileDetailPickerStyles}>
                        ${
                          profileDetails.length > 6
                            ? html`
                                <div class=${profileDetailSearchContainerStyles}>
                                  <input
                                    type="text"
                                    data-profile-detail-search
                                    placeholder=${searchDetailsText}
                                    aria-label=${searchDetailsText}
                                    class=${profileDetailSearchInputStyles(theme)}
                                    @input=${onSearchDetails}
                                    @keydown=${onSearchKeyDown}
                                  />
                                </div>
                              `
                            : nothing
                        }
                        ${profileDetails.map(
                          (detail) => html`
                            <div
                              data-cipher-content
                              data-profile-detail-row
                              data-search-text=${`${detail.label} ${detail.value}`}
                              class=${`${cipherItemContentStyles(theme)} ${profileDetailRowStyles}`}
                            >
                              <button
                                type="button"
                                data-profile-detail=${detail.key}
                                tabindex="-1"
                                class=${`${fillCipherButtonStyles} ${profileDetailButtonStyles(theme)}`}
                                aria-label=${`${fillText} ${detail.label}: ${detail.value}, ${cipher.name}`}
                                @click=${onFillDetail(detail.key)}
                                @keyup=${onFillKeyUp}
                              >
                                <span class=${profileDetailLabelStyles(theme)}>${detail.label}</span>
                                <span class=${profileDetailValueStyles(theme)}>${detail.value}</span>
                              </button>
                            </div>
                          `,
                        )}
                      </div>
                    `
                  : nothing
              }
            `
          : nothing
      }
    </div>
  `;
}

function handleFillCipherKeyUp(
  event: KeyboardEvent,
  onListEdgeReached?: (direction: 1 | -1) => void,
) {
  const listItem = getTrustedCipherKeyTarget(event, ["ArrowDown", "ArrowUp", "ArrowRight"]);
  if (!listItem) {
    return;
  }

  if (event.code === "ArrowRight") {
    focusViewCipherButton(listItem);
    return;
  }

  focusFillCipher(listItem, event.code === "ArrowDown" ? 1 : -1, onListEdgeReached, event.target);
}

function handleViewCipherKeyUp(
  event: KeyboardEvent,
  onListEdgeReached?: (direction: 1 | -1) => void,
) {
  const listItem = getTrustedCipherKeyTarget(event, ["ArrowDown", "ArrowUp", "ArrowLeft"]);
  if (!listItem) {
    return;
  }

  listItem.querySelector(CIPHER_CONTENT_SELECTOR)?.classList.remove("remove-outline");

  if (event.code === "ArrowLeft") {
    listItem.querySelector<HTMLElement>(FILL_CIPHER_SELECTOR)?.focus();
    return;
  }

  focusFillCipher(listItem, event.code === "ArrowDown" ? 1 : -1, onListEdgeReached);
}

function getTrustedCipherKeyTarget(event: KeyboardEvent, keys: string[]): HTMLElement | null {
  if (
    !EventSecurity.isEventTrusted(event) ||
    !keys.includes(event.code) ||
    !(event.target instanceof Element)
  ) {
    return null;
  }

  event.preventDefault();
  return event.target.closest(CIPHER_ITEM_SELECTOR);
}

function getNavigableFillButtons(root: Element | null | undefined): HTMLElement[] {
  if (!root) {
    return [];
  }
  return Array.from(root.querySelectorAll<HTMLElement>(FILL_CIPHER_SELECTOR)).filter(
    (el) => !el.closest("[hidden]"),
  );
}

function focusFillCipher(
  currentListItem: HTMLElement,
  direction: 1 | -1,
  onListEdgeReached?: (direction: 1 | -1) => void,
  currentButton?: EventTarget | null,
) {
  const buttons = getNavigableFillButtons(currentListItem);
  const currentIndex = buttons.indexOf(currentButton as HTMLElement);
  const sameItemFill = currentIndex < 0 ? undefined : buttons[currentIndex + direction];
  if (sameItemFill) {
    sameItemFill.focus();
    return;
  }
  const adjacentFills = getNavigableFillButtons(getAdjacentCipherItem(currentListItem, direction));
  const adjacentFill = direction === 1 ? adjacentFills[0] : adjacentFills[adjacentFills.length - 1];
  if (adjacentFill) {
    adjacentFill.focus();
    return;
  }

  if (onListEdgeReached) {
    onListEdgeReached(direction);
    return;
  }

  const fills = getNavigableFillButtons(currentListItem.parentElement);
  const fallback = direction === 1 ? fills[0] : fills[fills.length - 1];
  fallback?.focus();
}

function getAdjacentCipherItem(
  currentListItem: HTMLElement,
  direction: 1 | -1,
): HTMLElement | null {
  let sibling =
    direction === 1 ? currentListItem.nextElementSibling : currentListItem.previousElementSibling;

  while (sibling) {
    if (sibling.matches(CIPHER_ITEM_SELECTOR)) {
      return sibling as HTMLElement;
    }
    sibling = direction === 1 ? sibling.nextElementSibling : sibling.previousElementSibling;
  }

  return null;
}

function focusViewCipherButton(currentListItem: HTMLElement) {
  currentListItem.querySelector(CIPHER_CONTENT_SELECTOR)?.classList.add("remove-outline");
  currentListItem.querySelector<HTMLElement>("[data-view-cipher]")?.focus();
}

function getFillAriaDescription(
  cipher: InlineMenuCipherData,
  usernameText?: string,
  cardNumberEndsWithText?: string,
): string | undefined {
  if (cipher.login) {
    const username = cipher.login.username || cipher.login.passkey?.userName || "";
    return username && usernameText ? `${usernameText.toLowerCase()}: ${username}` : undefined;
  }

  if (!cipher.card || !cardNumberEndsWithText) {
    return undefined;
  }

  const cardParts = cipher.card.split(", *");
  if (cardParts.length === 1) {
    const cardDigits = cardParts[0].startsWith("*") ? cardParts[0].substring(1) : cardParts[0];
    return `${cardNumberEndsWithText} ${cardDigits}`;
  }

  return `${cardParts[0]}, ${cardNumberEndsWithText} ${cardParts[1]}`;
}

const cipherItemStyles = ({ bordered, theme }: { bordered: boolean; theme: Theme }) => css`
  box-sizing: border-box;
  width: 100%;
  padding: calc(${spacing["1"]} / 2);
  list-style: none;
  transition: background-color 0.2s ease-in-out;
  ${bordered ? `border-bottom: 1px solid ${themes[theme].secondary["300"]};` : ""}

  :hover {
    background-color: ${themes[theme].background.alt};
  }
`;

const cipherItemContentStyles = (theme: Theme) => css`
  box-sizing: border-box;
  display: flex;
  align-items: center;
  width: 100%;
  padding: ${spacing["2"]} ${spacing["1"]} ${spacing["2"]} ${spacing["2"]};
  border-radius: ${spacing["1"]};

  :has(:focus-visible):not(.remove-outline) {
    outline: 2px solid ${themes[theme].primary["600"]};
    outline-offset: 1px;
  }
`;

const fillCipherButtonStyles = css`
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: ${spacing["2"]};
  width: calc(100% - (${spacing["4"]} * 2 + ${spacing["2"]}));
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  outline: none;
  line-height: 0;
  overflow: hidden;

  :disabled {
    cursor: default;
  }

  > div {
    min-width: 0;
    line-height: normal;
  }
`;

const profileSecondaryRowStyles = css`
  justify-content: space-between;
  gap: ${spacing["2"]};
`;

const profileFormButtonStyles = (theme: Theme) => css`
  ${typography.body2}

  flex: 1 1 auto;
  min-width: 0;
  width: auto;
  padding-left: calc(${spacing["4"]} + ${spacing["2"]} * 2);
  color: ${themes[theme].text.main};
  line-height: normal;
`;

const profileChooseDetailButtonStyles = (theme: Theme) => css`
  ${typography.body2}

  flex: 0 0 auto;
  margin: 0;
  padding: calc(${spacing["1"]} / 2) ${spacing["2"]};
  border: none;
  border-radius: ${spacing["1"]};
  background: transparent;
  color: ${themes[theme].primary["600"]};
  cursor: pointer;
  white-space: nowrap;
  outline: none;

  :focus-visible {
    outline: 2px solid ${themes[theme].primary["600"]};
    outline-offset: 1px;
  }
`;

const profileDetailPickerStyles = css`
  width: 100%;
  max-height: 150px;
  overflow-y: auto;
  overflow-x: hidden;

  &[hidden] {
    display: none !important;
  }
`;

const profileDetailSearchContainerStyles = css`
  padding: ${spacing["1"]} ${spacing["2"]} ${spacing["1"]} calc(${spacing["4"]} + ${spacing["2"]} * 2);
`;

const profileDetailSearchInputStyles = (theme: Theme) => css`
  ${typography.body2}

  box-sizing: border-box;
  width: 100%;
  padding: ${spacing["1"]} ${spacing["2"]};
  border-radius: ${spacing["1"]};
  border: 1px solid ${themes[theme].secondary["300"]};
  background: ${themes[theme].background.DEFAULT};
  color: ${themes[theme].text.main};
`;

const profileDetailRowStyles = css`
  &[hidden] {
    display: none !important;
  }
`;

const profileDetailButtonStyles = (theme: Theme) => css`
  ${typography.body2}

  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: ${spacing["2"]};
  width: 100%;
  padding-left: calc(${spacing["4"]} + ${spacing["2"]} * 2);
  color: ${themes[theme].text.main};
  line-height: normal;
`;

const profileDetailLabelStyles = (theme: Theme) => css`
  flex: 0 0 auto;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: ${themes[theme].text.muted};
`;

const profileDetailValueStyles = (theme: Theme) => css`
  flex: 1 1 auto;
  min-width: 0;
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: ${themes[theme].text.main};
`;

const viewCipherButtonStyles = (theme: Theme) => css`
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: calc(${spacing["4"]} * 2 + ${spacing["2"]});
  height: calc(${spacing["4"]} * 2 + ${spacing["2"]});
  margin: 0;
  padding: 0;
  border: none;
  border-radius: ${spacing["1"]};
  background: transparent;
  cursor: pointer;
  line-height: 0;

  :focus {
    outline: 2px solid ${themes[theme].primary["600"]};
    outline-offset: 1px;
  }

  > svg {
    width: ${spacing["4"]};
    height: ${spacing["4"]};
  }
`;
