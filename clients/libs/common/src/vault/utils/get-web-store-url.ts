import { DeviceType } from "../../enums";

/**
 *  Returns the web store URL for the Vowkey browser extension based on the device type.
 *  @defaults Vowkey download page
 */
export const getWebStoreUrl = (deviceType: DeviceType): string => {
  switch (deviceType) {
    // DuckDuckGoBrowser is intentionally not mapped: only its Windows (Chromium) build can
    // install Chrome Web Store extensions, and this signature carries no platform
    // information, so it falls through to the generic download page.
    case DeviceType.ChromeBrowser:
      return "https://chromewebstore.google.com/detail/vowkey-password-manage/nngceckbapebfimnlniiiahkandclblb";
    case DeviceType.FirefoxBrowser:
      return "https://addons.mozilla.org/en-US/firefox/addon/vowkey-password-manager/";
    case DeviceType.SafariBrowser:
      return "https://apps.apple.com/us/app/vowkey/id1352778147?mt=12";
    case DeviceType.OperaBrowser:
      return "https://addons.opera.com/extensions/details/vowkey-free-password-manager/";
    case DeviceType.EdgeBrowser:
      return "https://microsoftedge.microsoft.com/addons/detail/jbkfoedolllekgbhcbcoahefnbanhhlh";
    default:
      return "https://vowkey.com/download/#downloads-web-browser";
  }
};
