export type SaveCopyMessage = {
  /** Where the form came from, so its filled copy can sit beside it. */
  sourcePath?: string;
  /** The form's file name. */
  name: string;
  bytes: Uint8Array;
};

/** A field of a PDF form, as PDFKit sees it. */
export type PdfFormField = {
  /** What the field is filled by. */
  key: string;
  name: string;
  tooltip: string;
  /** The printed line closest above or to the left of the box. */
  label: string;
  /** Nearest printed section/role heading above the field, when present. */
  section?: string;
  type: "text" | "select-one" | "checkbox" | "button" | "other";
  maxLength: number;
  options: string[];
};

export type ClassifiedFile = {
  kind: "form" | "document" | "ambiguous";
  widgets: number;
  formSignals: number;
  docSignals: number;
};

export type FillPdfMessage = {
  sourcePath?: string;
  name: string;
  bytes: Uint8Array;
  /** Values by field key. */
  values: Record<string, string>;
  /** Value-blind `@vk:` blueprint badges by field key for photographed paper forms. */
  blueprintValues?: Record<string, string>;
};

export type DecisionConfig = {
  url: string;
  hasKey: boolean;
};

export type UpdateDecisionConfigMessage = {
  url?: string;
  customUrl?: string;
  apiKey?: string;
  clearKey?: boolean;
};

export type DecisionSettings = {
  perRequest: number;
  /** True when Decision runs on this computer (an installed local model or a loopback endpoint). */
  local?: boolean;
};

export type DecisionModelRole = "recommended" | "most_accurate" | "fastest";

export type DecisionCatalogModel = {
  id: string;
  name: string;
  role?: DecisionModelRole;
  blurbKey: string;
  languages: "multilingual" | "english";
  accuracyPercent: number;
  decisionScore: number;
  memoryBytes: number;
  paramsLabel: string;
  repository: string;
  revision: string;
  filename: string;
  bytes: number;
  sha256: string;
  license: "apache-2.0" | "mit";
  perRequest: number;
  installed: boolean;
  /** Path in a local Hugging Face cache when already downloaded on this computer. */
  foundPath?: string;
};

export type DecisionCustomModel = {
  id: string;
  name: string;
  filePath: string;
  parentFolder: string;
  bytes: number;
  missing: boolean;
};

export type DecisionPreparationPhase = "downloading" | "verifying" | "loading";

export type DecisionPreparationState = {
  modelId: string;
  phase: DecisionPreparationPhase;
  downloadedBytes: number;
  totalBytes: number;
  error?: string;
};

export type DecisionModelsState = {
  selectedModelId: string;
  activeModelId: string | null;
  serverReady: boolean;
  preparation: DecisionPreparationState | null;
  catalog: DecisionCatalogModel[];
  customModels: DecisionCustomModel[];
};
