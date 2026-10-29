// eslint-disable-next-line no-restricted-imports
import { EncArrayBuffer, EncString } from "@vowkey/legacy-crypto";

import { FileUploadType } from "../../enums";

export abstract class FileUploadService {
  abstract upload(
    uploadData: { url: string; fileUploadType: FileUploadType },
    fileName: EncString,
    encryptedFileData: EncArrayBuffer,
    fileUploadMethods: FileUploadApiMethods,
    options?: UploadOptions,
  ): Promise<void>;
}

export type FileUploadApiMethods = {
  postDirect: (fileData: FormData) => Promise<void>;
  renewFileUploadUrl: () => Promise<string>;
  rollback: () => Promise<void>;
};

/** Options for file uploads */
export type UploadOptions = {
  /** Callback function to receive upload progress updates as a percentage (0-100) for uploads. */
  onProgress?: (percent: number) => void;
  /** An already allocated row whose bytes may need to be retried. */
  resume?: { attachmentId: string; uploadUrl: string; fileUploadType: FileUploadType };
  /** Persist the allocated row id before any bytes are uploaded. */
  onAllocated?: (allocation: { attachmentId: string; uploadUrl: string; fileUploadType: FileUploadType }) => Promise<void>;
  onUploaded?: (attachmentId: string) => Promise<void>;
};
