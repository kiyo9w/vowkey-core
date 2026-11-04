import { execFile, spawn, ChildProcess } from "child_process";
import { existsSync, mkdirSync } from "fs";
import * as fs from "fs/promises";
import * as path from "path";
import { promisify } from "util";

import { app, systemPreferences } from "electron";

const run = promisify(execFile);

const GUIDE_VERSION = "v1";
const ACCESSIBILITY_PANE =
  "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility";

/**
 * A floating panel that docks at the bottom-right of System Settings while the Accessibility list
 * is open. It holds a draggable Vowkey tile that drops straight into the list, flies out of the
 * Vowkey window to its place so the eye can follow it, and closes once access is granted.
 *
 * Arguments: `<app bundle path> <instruction template>`; the template takes `{app}` and `{list}`.
 * The helper exits when stdin closes, when System Settings closes after it was seen, or after ten
 * minutes.
 */
const PERMISSION_GUIDE_SWIFT = `
import AppKit
import CoreImage
import QuartzCore

let args = CommandLine.arguments
let bundleURL = URL(fileURLWithPath: args.count > 1 ? args[1] : "/Applications/Vowkey.app").standardized
let template = args.count > 2 ? args[2] : "↑  Drag {app} into the {list} list above"
let settingsBundleID = "com.apple.systempreferences"
let paneURL = URL(string: "${ACCESSIBILITY_PANE}")!

func appName(_ url: URL) -> String {
  var name = FileManager.default.displayName(atPath: url.path)
  if name.lowercased().hasSuffix(".app") { name = String(name.dropLast(4)) }
  return name.isEmpty ? "Vowkey" : name
}

/// macOS 27 renamed the Accessibility list.
func listName() -> String {
  let renamed = ProcessInfo.processInfo.isOperatingSystemAtLeast(
    OperatingSystemVersion(majorVersion: 27, minorVersion: 0, patchVersion: 0))
  return renamed ? "Device Control and Data Access" : "Accessibility"
}

func isDark(_ appearance: NSAppearance) -> Bool {
  appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
}

/// The tile as System Settings lists the app: icon and name.
func drawTile(_ bounds: NSRect, _ icon: NSImage, _ name: String, _ dark: Bool) {
  let bg = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: 8, yRadius: 8)
  NSColor(white: dark ? 0.18 : 1.0, alpha: 1).setFill()
  bg.fill()
  NSColor(white: dark ? 1 : 0, alpha: 0.12).setStroke()
  bg.lineWidth = 1
  bg.stroke()
  icon.draw(in: NSRect(x: 10, y: (bounds.height - 32) / 2, width: 32, height: 32))
  let attrs: [NSAttributedString.Key: Any] = [
    .font: NSFont.systemFont(ofSize: 13, weight: .semibold),
    .foregroundColor: NSColor(white: dark ? 0.94 : 0.07, alpha: 1),
  ]
  (name as NSString).draw(at: NSPoint(x: 52, y: (bounds.height - 16) / 2), withAttributes: attrs)
}

final class DragTile: NSView, NSDraggingSource {
  let url: URL
  let icon: NSImage
  let name: String
  var downEvent: NSEvent?

  init(frame: NSRect, url: URL) {
    self.url = url
    self.icon = NSWorkspace.shared.icon(forFile: url.path)
    self.icon.size = NSSize(width: 32, height: 32)
    self.name = appName(url)
    super.init(frame: frame)
  }

  required init?(coder: NSCoder) { nil }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  override func resetCursorRects() { addCursorRect(bounds, cursor: .openHand) }
  override func draw(_ dirtyRect: NSRect) { drawTile(bounds, icon, name, isDark(effectiveAppearance)) }
  override func mouseDown(with event: NSEvent) { downEvent = event }

  override func mouseDragged(with event: NSEvent) {
    guard let down = downEvent else { return }
    let dx = event.locationInWindow.x - down.locationInWindow.x
    let dy = event.locationInWindow.y - down.locationInWindow.y
    if hypot(dx, dy) < 3 { return }
    guard let rep = bitmapImageRepForCachingDisplay(in: bounds) else { return }
    cacheDisplay(in: bounds, to: rep)
    let snapshot = NSImage(size: bounds.size)
    snapshot.addRepresentation(rep)
    let item = NSDraggingItem(pasteboardWriter: url as NSURL)
    item.setDraggingFrame(bounds, contents: snapshot)
    let session = beginDraggingSession(with: [item], event: down, source: self)
    session.animatesToStartingPositionsOnCancelOrFail = true
    session.draggingFormation = .none
    downEvent = nil
  }

  func draggingSession(_ session: NSDraggingSession, sourceOperationMaskFor context: NSDraggingContext) -> NSDragOperation {
    .copy
  }
}

func settingsPID() -> pid_t? {
  NSRunningApplication.runningApplications(withBundleIdentifier: settingsBundleID).first?.processIdentifier
}

/// The largest on-screen System Settings window, in Quartz coordinates. Matching by process keeps
/// this working in every system language.
func settingsFrame() -> CGRect? {
  guard let pid = settingsPID(),
        let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]
  else { return nil }
  var best: CGRect?
  for window in windows {
    guard (window[kCGWindowOwnerPID as String] as? Int).map({ pid_t($0) }) == pid,
          (window[kCGWindowLayer as String] as? Int) == 0,
          let dict = window[kCGWindowBounds as String] as? NSDictionary,
          let frame = CGRect(dictionaryRepresentation: dict as CFDictionary),
          frame.width >= 300, frame.height >= 200
    else { continue }
    if best == nil || frame.width * frame.height > best!.width * best!.height { best = frame }
  }
  return best
}

func appKitFrame(_ frame: CGRect) -> NSRect {
  guard let primary = NSScreen.screens.first else { return frame }
  return NSRect(x: frame.minX, y: primary.frame.height - frame.minY - frame.height, width: frame.width, height: frame.height)
}

/// A System Settings that is not running yet restores its last pane and drops the one in the URL,
/// so after a cold launch the URL goes again once its window has settled.
func openPane() {
  let cold = settingsPID() == nil
  NSWorkspace.shared.open(paneURL)
  guard cold else { return }
  var polls = 0
  Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { timer in
    polls += 1
    if polls > 100 { timer.invalidate(); return }
    guard settingsFrame() != nil else { return }
    timer.invalidate()
    for delay in [0.35, 1.2] {
      DispatchQueue.main.asyncAfter(deadline: .now() + delay) { NSWorkspace.shared.open(paneURL) }
    }
  }
}

func clamp01(_ v: CGFloat) -> CGFloat { min(max(v, 0), 1) }
func easeInOutCubic(_ t: CGFloat) -> CGFloat { t < 0.5 ? 4 * t * t * t : 1 - pow(-2 * t + 2, 3) / 2 }
func easeOutCubic(_ t: CGFloat) -> CGFloat { 1 - pow(1 - t, 3) }

final class Guide {
  let panel: NSPanel
  let tile: DragTile
  var sawSettings = false
  var flightPanel: NSPanel?
  var flightLayer: CALayer?
  var flightOrigin = NSPoint.zero
  var flightShownAt: CFTimeInterval = 0
  var flightStartedAt: CFTimeInterval = 0
  let flightPadding: CGFloat = 40

  init() {
    let size = NSSize(width: 460, height: 112)
    panel = NSPanel(
      contentRect: NSRect(origin: .zero, size: size),
      styleMask: [.borderless, .nonactivatingPanel, .fullSizeContentView],
      backing: .buffered, defer: false)
    panel.isFloatingPanel = true
    panel.level = .floating
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = true
    panel.hidesOnDeactivate = false

    let content = NSView(frame: NSRect(origin: .zero, size: size))
    content.wantsLayer = true
    content.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
    content.layer?.cornerRadius = 16
    content.layer?.borderWidth = 1
    content.layer?.borderColor = NSColor(white: 0, alpha: 0.10).cgColor

    let text = template
      .replacingOccurrences(of: "{app}", with: appName(bundleURL))
      .replacingOccurrences(of: "{list}", with: listName())
    let label = NSTextField(labelWithString: text)
    label.frame = NSRect(x: 18, y: 72, width: size.width - 36, height: 22)
    label.font = NSFont.systemFont(ofSize: 13, weight: .medium)
    label.textColor = .labelColor
    content.addSubview(label)

    tile = DragTile(frame: NSRect(x: 18, y: 16, width: size.width - 36, height: 46), url: bundleURL)
    content.addSubview(tile)
    panel.contentView = content
  }

  func start() {
    let click = NSEvent.mouseLocation
    if !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
      tile.isHidden = true
      panel.alphaValue = 0
      beginFlight(from: click)
    }
    openPane()
    let timer = Timer(timeInterval: 0.12, repeats: true) { [weak self] _ in self?.follow() }
    RunLoop.main.add(timer, forMode: .common)
    follow()
  }

  func follow() {
    guard let quartz = settingsFrame() else {
      if sawSettings { exit(0) }
      return
    }
    sawSettings = true
    let settings = appKitFrame(quartz)
    let size = panel.frame.size
    let screen = NSScreen.screens.first { $0.frame.intersects(settings) } ?? NSScreen.main
    let visible = screen?.visibleFrame ?? settings
    var x = settings.maxX - size.width - 16
    var y = settings.minY + 16
    x = min(max(x, visible.minX + 8), visible.maxX - size.width - 8)
    y = min(max(y, visible.minY + 8), visible.maxY - size.height - 8)
    panel.setFrameOrigin(NSPoint(x: x, y: y))
    if flightPanel != nil && flightStartedAt == 0 { flightStartedAt = CACurrentMediaTime() }
    panel.orderFrontRegardless()
  }

  func beginFlight(from origin: NSPoint) {
    flightOrigin = origin
    flightShownAt = CACurrentMediaTime()
    let tileSize = tile.frame.size
    let icon = tile.icon
    let name = tile.name
    let dark = isDark(NSApp.effectiveAppearance)
    let image = NSImage(size: tileSize, flipped: false) { rect in
      drawTile(rect, icon, name, dark)
      return true
    }
    let size = NSSize(width: tileSize.width + 2 * flightPadding, height: tileSize.height + 2 * flightPadding)
    let fp = NSPanel(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    fp.level = NSWindow.Level(rawValue: NSWindow.Level.floating.rawValue + 1)
    fp.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
    fp.isOpaque = false
    fp.backgroundColor = .clear
    fp.hasShadow = false
    fp.ignoresMouseEvents = true
    fp.hidesOnDeactivate = false

    let host = NSView(frame: NSRect(origin: .zero, size: size))
    host.layer = CALayer()
    host.wantsLayer = true
    host.layerUsesCoreImageFilters = true
    let layer = CALayer()
    layer.bounds = CGRect(origin: .zero, size: tileSize)
    layer.position = CGPoint(x: size.width / 2, y: size.height / 2)
    layer.contents = image
    layer.contentsScale = NSScreen.main?.backingScaleFactor ?? 2
    layer.shadowOpacity = 0.25
    layer.shadowRadius = 12
    layer.shadowOffset = CGSize(width: 0, height: -6)
    if let blur = CIFilter(name: "CIGaussianBlur") {
      blur.name = "blur"
      blur.setValue(0, forKey: kCIInputRadiusKey)
      layer.filters = [blur]
    }
    host.layer?.addSublayer(layer)
    fp.contentView = host
    flightPanel = fp
    flightLayer = layer
    place(origin, scale: 0.7, blur: 4, opacity: 0)
    fp.orderFrontRegardless()
    let timer = Timer(timeInterval: 1.0 / 120, repeats: true) { [weak self] t in
      guard let self = self, self.flightPanel != nil else { t.invalidate(); return }
      self.stepFlight()
    }
    RunLoop.main.add(timer, forMode: .common)
  }

  func place(_ center: NSPoint, scale: CGFloat, blur: CGFloat, opacity: CGFloat) {
    guard let fp = flightPanel, let layer = flightLayer else { return }
    let size = fp.frame.size
    fp.setFrameOrigin(NSPoint(x: center.x - size.width / 2, y: center.y - size.height / 2))
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    layer.transform = CATransform3DMakeScale(scale, scale, 1)
    layer.opacity = Float(opacity)
    layer.setValue(blur, forKeyPath: "filters.blur.inputRadius")
    CATransaction.commit()
  }

  func endFlight() {
    flightPanel?.orderOut(nil)
    flightPanel = nil
    flightLayer = nil
    tile.isHidden = false
    panel.alphaValue = 1
  }

  func stepFlight() {
    let now = CACurrentMediaTime()
    if flightStartedAt == 0 {
      if now - flightShownAt > 4 { endFlight(); return }
      let t = easeOutCubic(clamp01(CGFloat((now - flightShownAt) / 0.18)))
      place(NSPoint(x: flightOrigin.x, y: flightOrigin.y + 12 * t), scale: 0.7 + 0.1 * t, blur: 4 * (1 - t), opacity: t)
      return
    }
    let t = clamp01(CGFloat((now - flightStartedAt) / 0.62))
    let e = easeInOutCubic(t)
    let start = NSPoint(x: flightOrigin.x, y: flightOrigin.y + 12)
    let slot = panel.convertToScreen(tile.convert(tile.bounds, to: nil))
    let end = NSPoint(x: slot.midX, y: slot.midY)
    let distance = hypot(end.x - start.x, end.y - start.y)
    let control = NSPoint(x: (start.x + end.x) / 2, y: max(start.y, end.y) + min(160, distance * 0.25))
    let u = 1 - e
    let point = NSPoint(
      x: u * u * start.x + 2 * u * e * control.x + e * e * end.x,
      y: u * u * start.y + 2 * u * e * control.y + e * e * end.y)
    place(point, scale: 0.8 + 0.2 * e, blur: 6 * sin(.pi * e), opacity: 1)
    panel.alphaValue = easeOutCubic(clamp01((t - 0.45) / 0.55))
    if t >= 1 { endFlight() }
  }
}

let application = NSApplication.shared
application.setActivationPolicy(.accessory)
let guide = Guide()
guide.start()
DispatchQueue.global().async {
  _ = FileHandle.standardInput.readDataToEndOfFile()
  DispatchQueue.main.async { exit(0) }
}
DispatchQueue.main.asyncAfter(deadline: .now() + 600) { exit(0) }
application.run()
`;

/** The pane URL is a fixed constant, so it opens directly rather than through the web URL allow-list. */
function openAccessibilityPane(): Promise<unknown> {
  return run("/usr/bin/open", [ACCESSIBILITY_PANE]).catch((): void => undefined);
}

/** Opens the Accessibility list and, in a packaged app, docks the drag guide beside it. */
export class MacosPermissionGuide {
  private binaryPath: string | null = null;
  private buildPromise: Promise<string | null> | null = null;
  private child: ChildProcess | null = null;
  private trustTimer: NodeJS.Timeout | null = null;

  constructor(private userDataPath: string) {}

  /** The `.app` bundle that System Settings lists, or `null` when running outside one. */
  static bundlePath(): string | null {
    const exe = app.getPath("exe");
    const marker = exe.indexOf(".app/");
    return marker > 0 ? exe.slice(0, marker + 4) : null;
  }

  async ensureBinary(): Promise<string | null> {
    if (process.platform !== "darwin") {
      return null;
    }
    if (this.binaryPath && existsSync(this.binaryPath)) {
      return this.binaryPath;
    }
    this.buildPromise ??= this.compile().finally(() => (this.buildPromise = null));
    return this.buildPromise;
  }

  private async compile(): Promise<string | null> {
    try {
      const binDir = path.join(this.userDataPath, "bin");
      mkdirSync(binDir, { recursive: true });
      const target = path.join(binDir, `vowkey-permission-guide-${GUIDE_VERSION}`);
      if (existsSync(target)) {
        this.binaryPath = target;
        return target;
      }
      if (!existsSync("/usr/bin/swiftc")) {
        return null;
      }
      const src = `${target}.swift`;
      const tmp = `${target}.tmp-${process.pid}`;
      await fs.writeFile(src, PERMISSION_GUIDE_SWIFT, "utf8");
      await run("/usr/bin/swiftc", ["-O", src, "-o", tmp], { timeout: 60_000 });
      await fs.rename(tmp, target);
      await fs.unlink(src).catch((): void => undefined);
      this.binaryPath = target;
      return target;
    } catch {
      return null;
    }
  }

  /**
   * Shows the guide for the Accessibility list. Returns `true` when the floating guide is up and
   * `false` when only the System Settings pane opened.
   */
  async show(template: string): Promise<boolean> {
    this.close();
    const bundle = MacosPermissionGuide.bundlePath();
    const bin = bundle ? await this.ensureBinary() : null;
    if (!bundle || !bin) {
      await openAccessibilityPane();
      return false;
    }
    const child = spawn(bin, [bundle, template], { stdio: ["pipe", "ignore", "ignore"] });
    child.on("exit", () => {
      if (this.child === child) {
        this.close();
      }
    });
    child.on("error", () => void openAccessibilityPane());
    this.child = child;
    this.trustTimer = setInterval(() => {
      if (systemPreferences.isTrustedAccessibilityClient(false)) {
        this.close();
      }
    }, 400);
    return true;
  }

  close(): void {
    if (this.trustTimer != null) {
      clearInterval(this.trustTimer);
      this.trustTimer = null;
    }
    const child = this.child;
    this.child = null;
    if (child != null && child.exitCode == null) {
      child.stdin?.end();
      setTimeout(() => child.exitCode == null && child.kill(), 500);
    }
  }

  /**
   * Clears this app's Accessibility entry so a stale one from an older copy stops holding the
   * switch off, then asks macOS to list the running app again.
   */
  async resetAccessibility(): Promise<boolean> {
    if (process.platform !== "darwin") {
      return true;
    }
    const bundle = MacosPermissionGuide.bundlePath();
    if (bundle) {
      try {
        const { stdout } = await run("/usr/bin/plutil", [
          "-extract",
          "CFBundleIdentifier",
          "raw",
          path.join(bundle, "Contents", "Info.plist"),
        ]);
        const bundleId = stdout.trim();
        if (bundleId) {
          await run("/usr/bin/tccutil", ["reset", "Accessibility", bundleId], { timeout: 5_000 });
        }
      } catch {
        // tccutil exits non-zero when there was no entry to clear.
      }
    }
    return systemPreferences.isTrustedAccessibilityClient(true);
  }
}
