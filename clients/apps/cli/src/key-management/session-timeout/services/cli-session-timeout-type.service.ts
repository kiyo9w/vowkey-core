import { SessionTimeoutTypeService } from "@vowkey/common/key-management/session-timeout";
import {
  VaultTimeout,
  VaultTimeoutStringType,
} from "@vowkey/common/key-management/vault-timeout";

export class CliSessionTimeoutTypeService implements SessionTimeoutTypeService {
  async isAvailable(timeout: VaultTimeout): Promise<boolean> {
    return timeout === VaultTimeoutStringType.Never;
  }

  async getOrPromoteToAvailable(_: VaultTimeout): Promise<VaultTimeout> {
    return VaultTimeoutStringType.Never;
  }
}
