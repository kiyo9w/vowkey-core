import { DeviceType } from "../../enums";

/**
 * Returns the download URL for the Vowkey browser extension based on the device type.
 */
export const getWebStoreUrl = (deviceType: DeviceType): string => {
  switch (deviceType) {
    case DeviceType.ChromeBrowser:
    case DeviceType.EdgeBrowser:
    case DeviceType.OperaBrowser:
      return "https://vowkey.app/releases/Vowkey-Chrome-Extension.zip";
    default:
      return "https://vowkey.app/#download";
  }
};
