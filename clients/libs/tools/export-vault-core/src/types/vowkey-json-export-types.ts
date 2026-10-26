import {
  CipherWithIdExport,
  CollectionWithIdExport,
  FolderWithIdExport,
} from "@vowkey/common/models/export";

// Base
export type VowkeyJsonExport = VowkeyUnEncryptedJsonExport | VowkeyEncryptedJsonExport;

// Decrypted
export type VowkeyUnEncryptedJsonExport =
  VowkeyUnEncryptedIndividualJsonExport | VowkeyUnEncryptedOrgJsonExport;

export type VowkeyUnEncryptedIndividualJsonExport = {
  encrypted: false;
  items: CipherWithIdExport[];
  folders: FolderWithIdExport[];
};

export type VowkeyUnEncryptedOrgJsonExport = {
  encrypted: false;
  items: CipherWithIdExport[];
  collections: CollectionWithIdExport[];
};

// Account-encrypted
export type VowkeyEncryptedJsonExport =
  VowkeyEncryptedIndividualJsonExport | VowkeyEncryptedOrgJsonExport;

export type VowkeyEncryptedIndividualJsonExport = {
  encrypted: true;
  encKeyValidation_DO_NOT_EDIT: string;
  items: CipherWithIdExport[];
  folders: FolderWithIdExport[];
};

export type VowkeyEncryptedOrgJsonExport = {
  encrypted: true;
  encKeyValidation_DO_NOT_EDIT: string;
  items: CipherWithIdExport[];
  collections: CollectionWithIdExport[];
};

// Password-protected
export type VowkeyPasswordProtectedFileFormat = {
  encrypted: true;
  passwordProtected: true;
  salt: string;
  kdfIterations: number;
  kdfMemory?: number;
  kdfParallelism?: number;
  kdfType: number;
  encKeyValidation_DO_NOT_EDIT: string;
  data: string;
};

// Unencrypted type guards
export function isUnencrypted(
  data: VowkeyJsonExport | null | undefined,
): data is VowkeyUnEncryptedJsonExport {
  return data != null && (data as { encrypted?: unknown }).encrypted !== true;
}

export function isIndividualUnEncrypted(
  data: VowkeyJsonExport | null | undefined,
): data is VowkeyUnEncryptedIndividualJsonExport {
  return isUnencrypted(data) && (data as { folders?: unknown }).folders != null;
}

export function isOrgUnEncrypted(
  data: VowkeyJsonExport | null | undefined,
): data is VowkeyUnEncryptedOrgJsonExport {
  return isUnencrypted(data) && (data as { collections?: unknown }).collections != null;
}

// Encrypted type guards
export function isEncrypted(
  data: VowkeyJsonExport | null | undefined,
): data is VowkeyEncryptedJsonExport {
  return data != null && (data as { encrypted?: unknown }).encrypted === true;
}
export function isPasswordProtected(
  data: VowkeyPasswordProtectedFileFormat | VowkeyJsonExport | null | undefined,
): data is VowkeyPasswordProtectedFileFormat {
  return (
    data != null &&
    (data as { encrypted?: unknown }).encrypted === true &&
    (data as { passwordProtected?: unknown }).passwordProtected === true
  );
}

export function isIndividualEncrypted(
  data: VowkeyJsonExport | null | undefined,
): data is VowkeyEncryptedIndividualJsonExport {
  return isEncrypted(data) && (data as { folders?: unknown }).folders != null;
}

export function isOrgEncrypted(
  data: VowkeyJsonExport | null | undefined,
): data is VowkeyEncryptedOrgJsonExport {
  return isEncrypted(data) && (data as { collections?: unknown }).collections != null;
}
