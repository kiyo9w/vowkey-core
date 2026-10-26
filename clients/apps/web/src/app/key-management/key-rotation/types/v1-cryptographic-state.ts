import { UserKey } from "@vowkey/common/types/key";
// eslint-disable-next-line no-restricted-imports
import { UnsignedPublicKey, WrappedPrivateKey } from "@vowkey/legacy-crypto";

export type V1UserCryptographicState = {
  userKey: UserKey;
  publicKeyEncryptionKeyPair: {
    wrappedPrivateKey: WrappedPrivateKey;
    publicKey: UnsignedPublicKey;
  };
};
