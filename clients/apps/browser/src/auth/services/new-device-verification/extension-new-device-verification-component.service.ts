import {
  DefaultNewDeviceVerificationComponentService,
  NewDeviceVerificationComponentService,
} from "@vowkey/auth/angular";

export class ExtensionNewDeviceVerificationComponentService
  extends DefaultNewDeviceVerificationComponentService
  implements NewDeviceVerificationComponentService
{
  showBackButton() {
    return false;
  }
}
