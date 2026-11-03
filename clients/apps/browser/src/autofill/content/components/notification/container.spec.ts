import { nothing } from "lit";

import { ThemeTypes } from "@vowkey/common/platform/enums";

import { NotificationTypes } from "../../../notification/abstractions/notification-bar";
import { EventSecurity } from "../../../utils/event-security";
import { NotificationCipherData } from "../cipher/types";
import { mockI18n } from "../lit-stories/mock-data";

import { NotificationBody } from "./body";
import { NotificationContainer } from "./container";
import { NotificationFooter } from "./footer";
import { NotificationHeader } from "./header";

jest.mock("lit", () => ({
  html: jest.fn((_strings: TemplateStringsArray, ...values: any[]) => values),
  nothing: Symbol("nothing"),
}));
jest.mock("@emotion/css", () => ({ css: jest.fn(() => "") }));
jest.mock("./header", () => ({
  NotificationHeader: jest.fn(),
  componentClassPrefix: "notification-header",
}));
jest.mock("./body", () => ({
  NotificationBody: jest.fn(),
  componentClassPrefix: "notification-body",
}));
jest.mock("./footer", () => ({
  NotificationFooter: jest.fn(),
}));

const makeCipher = (
  id: string,
  username: string,
  isNewDraft = false,
): NotificationCipherData => ({
  id,
  name: "github.com",
  type: 1,
  reprompt: 0,
  favorite: false,
  isNewDraft,
  icon: { imageEnabled: false, image: "", fallbackImage: "", icon: "" },
  login: { username },
});

describe("NotificationContainer", () => {
  const baseProps = {
    handleCloseNotification: jest.fn(),
    handleSaveAction: jest.fn(),
    handleEditOrUpdateAction: jest.fn(),
    i18n: {
      ...mockI18n,
      newItem: "New item",
      updateExisting: "Update existing",
      saveLogin: "Save login",
      updateLogin: "Update login",
    },
    notificationTestId: "save-notification-bar",
    theme: ThemeTypes.Light,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("hides segmented mode tabs on Add notifications when no existing site login exists", () => {
    const draft = makeCipher("", "new@example.com", true);
    const values = NotificationContainer({
      ...baseProps,
      type: NotificationTypes.Add,
      ciphers: [draft],
    }) as unknown as any[];

    expect(NotificationHeader).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Save login" }),
    );
    expect(NotificationBody).toHaveBeenCalledWith(
      expect.objectContaining({ ciphers: [draft] }),
    );
    expect(NotificationFooter).toHaveBeenCalledWith(
      expect.objectContaining({ activeMode: "new", notificationType: NotificationTypes.Add }),
    );
    expect(values[3]).toBe(nothing);
  });

  it("switches between New item and Update existing when existing logins are present on Add", () => {
    jest.spyOn(EventSecurity, "isEventTrusted").mockReturnValue(true);
    const handleModeChange = jest.fn();
    const draft = makeCipher("", "second@example.com", true);
    const existing = makeCipher("existing-1", "first@example.com", false);

    const values = NotificationContainer({
      ...baseProps,
      type: NotificationTypes.Add,
      activeMode: "new",
      ciphers: [draft, existing],
      handleModeChange,
    }) as unknown as any[];

    const segmentedSlot = values[3] as any[];
    expect(segmentedSlot[7]).toBe(false);

    // Click Update existing tab (handler at index 9)
    segmentedSlot[9](new MouseEvent("click"));
    expect(handleModeChange).toHaveBeenCalledWith("update");

    // Re-render in update mode shows existing cipher and Update login title
    NotificationContainer({
      ...baseProps,
      type: NotificationTypes.Add,
      activeMode: "update",
      ciphers: [draft, existing],
      selectedCipherId: "existing-1",
    });

    expect(NotificationHeader).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: "Update login" }),
    );
    expect(NotificationBody).toHaveBeenLastCalledWith(
      expect.objectContaining({
        ciphers: [existing],
        selectedCipherId: "existing-1",
      }),
    );
    expect(NotificationFooter).toHaveBeenLastCalledWith(
      expect.objectContaining({ activeMode: "update" }),
    );
  });

  it("omits segmented mode tabs and body on Unlock notifications", () => {
    const values = NotificationContainer({
      ...baseProps,
      type: NotificationTypes.Unlock,
      headerMessage: "Unlock to save",
    }) as unknown as any[];

    expect(values[3]).toBe(nothing);
    expect(values[4]).toBe(nothing);
  });
});
