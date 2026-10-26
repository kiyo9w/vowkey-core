/**
 * Common types and interfaces used across the Vowkey MCP Server
 */

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

export interface CliResponse {
  output?: string;
  errorOutput?: string;
}

export interface ApiResponse {
  data?: unknown;
  errorMessage?: string;
  status?: number;
}

export interface VowkeyItem {
  readonly id?: string;
  name?: string;
  notes?: string;
  type?: number;
  folderId?: string;
  login?: {
    username?: string;
    password?: string;
    uris?: readonly {
      readonly uri: string;
      readonly match?: number | undefined;
    }[];
    totp?: string;
  };
  card?: {
    cardholderName?: string;
    number?: string;
    brand?: string;
    expMonth?: string;
    expYear?: string;
    code?: string;
  };
  identity?: {
    title?: string;
    firstName?: string;
    middleName?: string;
    lastName?: string;
    address1?: string;
    address2?: string;
    address3?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
    company?: string;
    email?: string;
    phone?: string;
    ssn?: string;
    username?: string;
    passportNumber?: string;
    licenseNumber?: string;
  };
  secureNote?: {
    type?: number;
  };
}

export interface VowkeyFolder {
  readonly id?: string;
  name?: string;
}

export interface VowkeySend {
  readonly id?: string;
  readonly accessId?: string;
  name?: string;
  notes?: string;
  type?: number; // 0: Text, 1: File
  text?: {
    text?: string;
    hidden?: boolean;
  };
  file?: {
    fileName?: string;
    size?: number;
    sizeName?: string;
  };
  password?: string;
  maxAccessCount?: number;
  accessCount?: number;
  revisionDate?: string;
  expirationDate?: string;
  deletionDate?: string;
  disabled?: boolean;
}
