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
  type: "text" | "select-one" | "checkbox" | "button" | "other";
  maxLength: number;
  options: string[];
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
