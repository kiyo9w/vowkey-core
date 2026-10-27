export type SaveCopyMessage = {
  /** Where the form came from, so its filled copy can sit beside it. */
  sourcePath?: string;
  /** The form's file name. */
  name: string;
  bytes: Uint8Array;
};
