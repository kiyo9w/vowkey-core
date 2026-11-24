import { TestBed } from "@angular/core/testing";
import { BehaviorSubject } from "rxjs";

import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { PlatformUtilsService } from "@vowkey/common/platform/abstractions/platform-utils.service";
import { UserId } from "@vowkey/common/types/guid";
import { CipherSdkService } from "@vowkey/common/vault/abstractions/cipher-sdk.service";
import { CipherService } from "@vowkey/common/vault/abstractions/cipher.service";
import { CipherType } from "@vowkey/common/vault/enums";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import {
  addTypedDetail,
  humanizeDocumentTitle,
  newEnvelope,
  writeEnvelope,
} from "@vowkey/common/vault/profile/vk-meta";

import { PROFILE_DOCUMENT_ACTIONS, ProfileComponent } from "./profile.component";

describe("ProfileComponent AI rules", () => {
  it("keeps the saved rule visible until the new rule is saved, without changing the detail", async () => {
    const userId = "11111111-1111-4111-8111-111111111111" as UserId;
    const profile = new CipherView();
    profile.id = "22222222-2222-4222-8222-222222222222";
    profile.type = CipherType.Identity;
    profile.name = "Atelier Šimek";
    profile.edit = true;
    const meta = newEnvelope(profile.id);
    addTypedDetail(meta, {
      label: "Membership / 会員番号",
      value: "ÖPNV–00017 / 東京",
      valueType: "text",
    });
    writeEnvelope(profile, meta);

    const { promise: saving, resolve: saveStarted } = Promise.withResolvers<void>();
    const { promise: saved, resolve: finishSave } = Promise.withResolvers<void>();
    TestBed.configureTestingModule({
      imports: [ProfileComponent],
      providers: [
        {
          provide: AccountService,
          useValue: { activeAccount$: new BehaviorSubject({ id: userId }) },
        },
        {
          provide: CipherService,
          useValue: {
            get: async () => ({ id: profile.id }),
            decrypt: async () => profile,
            updateWithServer: async (updated: CipherView) => {
              saveStarted();
              await saved;
              return updated;
            },
          },
        },
        { provide: CipherSdkService, useValue: {} },
        { provide: PlatformUtilsService, useValue: {} },
      ],
    });
    const fixture = TestBed.createComponent(ProfileComponent);
    fixture.componentRef.setInput("cipher", profile);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const changing = fixture.componentInstance.setDetailRule(meta.details[0], "never");
    const row: HTMLElement = fixture.nativeElement.querySelector(".vk-detail");
    try {
      await saving;
      fixture.detectChanges();
      expect(row.querySelector(".vk-rule-pill.ask")?.textContent).toContain("Ask first");
      expect(row.querySelector(".vk-rule-pill.never")).toBeNull();
      expect(row.querySelector(".vk-val-btn")?.textContent).toContain("ÖPNV–00017 / 東京");
    } finally {
      finishSave();
      await changing;
    }
    fixture.detectChanges();
    expect(row.querySelector(".vk-rule-pill.never")?.textContent).toContain("Don't fill");
    expect(row.querySelector(".vk-rule-pill.ask")).toBeNull();
    expect(row.querySelector(".vk-row-label")?.textContent).toContain("Membership / 会員番号");
    expect(row.querySelector(".vk-val-btn")?.textContent).toContain("ÖPNV–00017 / 東京");
  });

  it("copies and focuses the OCR region when clicking anywhere on a detail row, with redundant action buttons removed", async () => {
    const userId = "11111111-1111-4111-8111-111111111111" as UserId;
    const profile = new CipherView();
    profile.id = "33333333-3333-4333-8333-333333333333";
    profile.type = CipherType.Identity;
    profile.name = "Trần Bảo Ngọc";
    profile.edit = true;
    const meta = newEnvelope(profile.id);
    meta.sources.push({
      id: "src-1",
      attachmentId: null,
      fileName: "03-student-id.png",
      mediaType: "image/png",
      kind: "student_id",
      documentDate: null,
      effectiveOn: null,
      capturedAt: "2026-01-01T00:00:00Z",
      expiresOn: null,
      status: "current",
    });
    addTypedDetail(meta, {
      label: "Full name",
      value: "TRAN BAO NGOC",
      valueType: "text",
    });
    meta.details[0].variants[0].sourceId = "src-1";
    meta.details[0].variants[0].locator = {
      kind: "page",
      page: 0,
      x: 0.12,
      y: 0.22,
      w: 0.4,
      h: 0.08,
    };
    writeEnvelope(profile, meta);

    const copiedValues: string[] = [];
    TestBed.configureTestingModule({
      imports: [ProfileComponent],
      providers: [
        {
          provide: AccountService,
          useValue: { activeAccount$: new BehaviorSubject({ id: userId }) },
        },
        {
          provide: CipherService,
          useValue: {
            get: async () => ({ id: profile.id }),
            decrypt: async () => profile,
          },
        },
        { provide: CipherSdkService, useValue: {} },
        {
          provide: PlatformUtilsService,
          useValue: {
            copyToClipboard: (val: string) => copiedValues.push(val),
            showToast: () => undefined,
          },
        },
        {
          provide: PROFILE_DOCUMENT_ACTIONS,
          useValue: {
            remove: async () => profile,
            move: async () => profile,
            profiles: async () => [],
          },
        },
      ],
    });

    const fixture = TestBed.createComponent(ProfileComponent);
    fixture.componentRef.setInput("cipher", profile);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const hostEl = fixture.nativeElement as HTMLElement;
    const menuText = hostEl.textContent ?? "";
    expect(menuText).not.toContain("Replace document");
    expect(menuText).not.toContain("Large type");
    expect(hostEl.querySelector('[title="Copy"]')).toBeNull();
    expect(hostEl.querySelector('[title="Show in document"]')).toBeNull();

    const row = hostEl.querySelector<HTMLElement>(".vk-detail")!;
    const labelCell = row.querySelector<HTMLElement>(".vk-row-label")!;
    labelCell.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(copiedValues).toEqual(["TRAN BAO NGOC"]);
    expect(row.classList.contains("located")).toBe(true);
    expect(fixture.componentInstance.selectedLocator()).toEqual({
      kind: "page",
      page: 0,
      x: 0.12,
      y: 0.22,
      w: 0.4,
      h: 0.08,
    });

    expect(humanizeDocumentTitle("03-student-id.png", "Trần Minh Khoa")).toBe("Student ID");
    expect(humanizeDocumentTitle("04-my-number-card.png", "Trần Minh Khoa")).toBe("My Number Card");
    expect(humanizeDocumentTitle("Residence Card – Lan Anh.png", "Lan Anh")).toBe(
      "Residence Card",
    );
  });
});
