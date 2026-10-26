import { CipherRepromptType } from "@vowkey/common/vault/enums/cipher-reprompt-type";

export type VowkeyCsvExportType = {
  type: string;
  name: string;
  notes: string;
  fields: string;
  reprompt: CipherRepromptType;
  // Login props
  login_uri: string[];
  login_username: string;
  login_password: string;
  login_totp: string;
  favorite: number | null;
  archivedDate: string | null;
};

export type VowkeyCsvIndividualExportType = VowkeyCsvExportType & {
  folder: string | null;
};

export type VowkeyCsvOrgExportType = VowkeyCsvExportType & {
  collections: string[] | null;
};
