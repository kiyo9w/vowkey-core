import { WebAuthnChallengeResponse } from "@vowkey/common/auth/models/response/web-authn-challenge.response";

export class CredentialCreateOptionsView {
  constructor(
    readonly options: WebAuthnChallengeResponse,
    readonly token: string,
  ) {}
}
