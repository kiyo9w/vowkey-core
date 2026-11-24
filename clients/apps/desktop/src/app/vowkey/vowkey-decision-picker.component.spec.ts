import { TestBed } from "@angular/core/testing";
import { mock } from "jest-mock-extended";

import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";

import type { DecisionCatalogModel, DecisionModelsState } from "../../capture/types/capture";

import {
  formatModelBytes,
  singleWinnerIndex,
  VowkeyDecisionPickerComponent,
} from "./vowkey-decision-picker.component";

function catalogFixture(): DecisionCatalogModel[] {
  return [
    {
      id: "vllm-d3-mini",
      name: "vLLM-D3 Mini",
      role: "recommended",
      blurbKey: "vkModelBlurbD3Mini",
      languages: "multilingual",
      accuracyPercent: 86.2,
      decisionScore: 31.4,
      memoryBytes: 4_500_000_000,
      paramsLabel: "4B",
      bytes: 3_690_000_000,
      license: "apache-2.0",
      installed: false,
    },
    {
      id: "elephant-1",
      name: "Elephant-1",
      role: "most_accurate",
      blurbKey: "vkModelBlurbElephant1",
      languages: "multilingual",
      accuracyPercent: 91.7,
      decisionScore: 44.8,
      memoryBytes: 11_200_000_000,
      paramsLabel: "9B",
      bytes: 9_540_000_000,
      license: "apache-2.0",
      installed: false,
    },
    {
      id: "vllm-d3-edge",
      name: "vLLM-D3 Edge",
      role: "fastest",
      blurbKey: "vkModelBlurbD3Edge",
      languages: "multilingual",
      accuracyPercent: 68.4,
      decisionScore: 14.9,
      memoryBytes: 1_200_000_000,
      paramsLabel: "0.8B",
      bytes: 806_000_000,
      license: "apache-2.0",
      installed: true,
    },
    {
      id: "julia-1",
      name: "Julia-1",
      blurbKey: "vkModelBlurbJulia1",
      languages: "english",
      accuracyPercent: 37.4,
      decisionScore: 4.8,
      memoryBytes: 400_000_000,
      paramsLabel: "0.14B",
      bytes: 168_000_000,
      license: "apache-2.0",
      installed: false,
      foundPath: "/Users/test/.cache/huggingface/hub/Julia-1-Q8_0.gguf",
    },
  ];
}

describe("VowkeyDecisionPickerComponent", () => {
  function setup(stateOverrides: Partial<DecisionModelsState> = {}, localModeActive = false) {
    const i18n = mock<I18nService>();
    i18n.t.mockImplementation((key: string, ...args: string[]) =>
      args.length > 0 ? `${key}:${args.join(",")}` : key,
    );

    TestBed.configureTestingModule({
      imports: [VowkeyDecisionPickerComponent],
      providers: [{ provide: I18nService, useValue: i18n }],
    });

    const fixture = TestBed.createComponent(VowkeyDecisionPickerComponent);
    const state: DecisionModelsState = {
      selectedModelId: "vllm-d3-mini",
      activeModelId: null,
      serverReady: false,
      preparation: null,
      catalog: catalogFixture(),
      customModels: [
        {
          id: "custom-0123456789abcdef",
          name: "Custom-Local",
          filePath: "/Users/test/Models/Custom-Local.gguf",
          parentFolder: "Models",
          bytes: 512_000_000,
          missing: false,
        },
      ],
      ...stateOverrides,
    };
    fixture.componentRef.setInput("state", state);
    fixture.componentRef.setInput("localModeActive", localModeActive);
    fixture.detectChanges();
    return fixture;
  }

  it("formats byte sizes cleanly and highlights only unique metric winners", () => {
    expect(formatModelBytes(806_000_000)).toBe("806 MB");
    expect(formatModelBytes(3_690_000_000)).toBe("3.7 GB");
    expect(singleWinnerIndex([86.2, 91.7, 68.4], "max")).toBe(1);
    expect(singleWinnerIndex([4500, 11200, 1200], "min")).toBe(2);
    expect(singleWinnerIndex([91.7, 91.7, 68.4], "max")).toBe(-1);
  });

  it("renders the 3-column Compare view with single primary CTA, switches to All models, and enforces two-click armed delete", () => {
    const fixture = setup();
    const downloaded: string[] = [];
    const used: string[] = [];
    const deleted: string[] = [];
    fixture.componentInstance.downloadRequested.subscribe((id) => downloaded.push(id));
    fixture.componentInstance.useRequested.subscribe((id) => used.push(id));
    fixture.componentInstance.deleteRequested.subscribe((id) => deleted.push(id));

    const el = fixture.nativeElement as HTMLElement;
    const primaryButtons = el.querySelectorAll(".vk-mp-btn.primary");
    expect(primaryButtons.length).toBe(1);

    const miniDownload = el.querySelector<HTMLButtonElement>(
      '[data-testid="vk-mp-download-vllm-d3-mini"]',
    )!;
    expect(miniDownload.classList.contains("primary")).toBe(true);
    miniDownload.click();
    expect(downloaded).toEqual(["vllm-d3-mini"]);

    const edgeUse = el.querySelector<HTMLButtonElement>('[data-testid="vk-mp-use-vllm-d3-edge"]')!;
    edgeUse.click();
    expect(used).toEqual(["vllm-d3-edge"]);

    const moreBtn = el.querySelector<HTMLButtonElement>('[data-testid="vk-mp-more-models"]')!;
    expect(moreBtn.textContent).toContain("vkModelMoreModels:2");
    moreBtn.click();
    fixture.detectChanges();

    const allList = el.querySelector('[data-testid="vk-decision-picker-all"]')!;
    expect(allList.textContent).toContain("Custom-Local");
    expect(allList.textContent).toContain("vkModelFoundOnComputer");

    // First click on custom model trash arms "Forget it?" without deleting
    const customTrash = el.querySelector<HTMLButtonElement>(
      '[data-testid="vk-mp-delete-custom-0123456789abcdef"]',
    )!;
    customTrash.click();
    fixture.detectChanges();
    expect(deleted).toEqual([]);
    expect(customTrash.classList.contains("armed")).toBe(true);
    expect(customTrash.textContent).toContain("vkModelForgetConfirm");

    // Clicking outside the armed trash button disarms without deleting
    const customRow = el.querySelector<HTMLElement>(
      '[data-testid="vk-mp-row-custom-0123456789abcdef"]',
    )!;
    customRow.click();
    fixture.detectChanges();
    expect(deleted).toEqual([]);
    expect(customTrash.classList.contains("armed")).toBe(false);

    // Arm + confirm deletes on second click
    const edgeTrash = el.querySelector<HTMLButtonElement>(
      '[data-testid="vk-mp-delete-vllm-d3-edge"]',
    )!;
    edgeTrash.click();
    fixture.detectChanges();
    expect(deleted).toEqual([]);
    expect(edgeTrash.textContent).toContain("vkModelDeleteConfirm:806 MB");
    edgeTrash.click();
    fixture.detectChanges();
    expect(deleted).toEqual(["vllm-d3-edge"]);
  });
});
