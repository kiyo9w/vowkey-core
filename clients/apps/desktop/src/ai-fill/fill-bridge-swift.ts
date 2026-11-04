/**
 * Swift source of the AI fill helper. It is compiled once into the user data folder, like the
 * Accessibility bridge, and runs inside Vowkey's Accessibility and Screen Recording grants.
 *
 * Modes (requests arrive as JSON on stdin, answers leave as JSON on stdout):
 * - `scan {pid}`: the target window's fields, controls and text, each with a child-index path.
 * - `act {pid, ops}`: fills, presses, selects, clicks, types, presses keys and scrolls, in order.
 * - `window {pid}`: the target window's frame and CoreGraphics window number for screenshots.
 */
export const FILL_BRIDGE_SWIFT = String.raw`
import AppKit
import ApplicationServices
import Foundation

struct Frame: Codable { let x: Double; let y: Double; let w: Double; let h: Double }

struct Element: Codable {
  let id: String
  let role: String
  let subrole: String?
  let label: String?
  let value: String?
  let placeholder: String?
  let frame: Frame?
  let enabled: Bool?
  let focused: Bool?
  let secure: Bool?
  let settable: Bool?
  let options: [String]?
}

struct ScanOut: Codable {
  let appName: String?
  let bundleId: String?
  let pid: Int32
  let windowTitle: String?
  let window: Frame?
  let elements: [Element]
  let truncated: Bool
  let note: String?
}

struct Op: Codable {
  let op: String
  let id: String?
  let value: String?
  let x: Double?
  let y: Double?
  let count: Int?
  let key: String?
  let modifiers: [String]?
  let dy: Double?
  let dx: Double?
}

struct ActIn: Codable { let pid: Int32; let ops: [Op] }
struct ScanIn: Codable { let pid: Int32?; let maxElements: Int? }

struct OpResult: Codable {
  let op: String
  let id: String?
  let ok: Bool
  let method: String?
  let readback: String?
  let error: String?
}

struct WindowOut: Codable {
  let pid: Int32
  let frame: Frame?
  let windowNumber: Int?
  let title: String?
}

func str(_ e: AXUIElement, _ a: String) -> String? {
  var ref: CFTypeRef?
  guard AXUIElementCopyAttributeValue(e, a as CFString, &ref) == .success, let v = ref else { return nil }
  if CFGetTypeID(v) == CFStringGetTypeID() {
    let s = (v as! String).trimmingCharacters(in: .whitespacesAndNewlines)
    return s.isEmpty ? nil : s
  }
  if CFGetTypeID(v) == CFNumberGetTypeID() { return (v as! NSNumber).stringValue }
  if CFGetTypeID(v) == CFBooleanGetTypeID() { return (v as! Bool) ? "1" : "0" }
  if CFGetTypeID(v) == CFAttributedStringGetTypeID() {
    let s = (v as! NSAttributedString).string.trimmingCharacters(in: .whitespacesAndNewlines)
    return s.isEmpty ? nil : s
  }
  return nil
}

func elem(_ e: AXUIElement, _ a: String) -> AXUIElement? {
  var ref: CFTypeRef?
  guard AXUIElementCopyAttributeValue(e, a as CFString, &ref) == .success, let v = ref,
        CFGetTypeID(v) == AXUIElementGetTypeID() else { return nil }
  return (v as! AXUIElement)
}

func bool(_ e: AXUIElement, _ a: String) -> Bool? {
  var ref: CFTypeRef?
  guard AXUIElementCopyAttributeValue(e, a as CFString, &ref) == .success, let v = ref,
        CFGetTypeID(v) == CFBooleanGetTypeID() else { return nil }
  return (v as! Bool)
}

func children(_ e: AXUIElement) -> [AXUIElement] {
  var ref: CFTypeRef?
  if AXUIElementCopyAttributeValue(e, kAXChildrenAttribute as CFString, &ref) == .success,
     let arr = ref as? [AXUIElement] { return arr }
  return []
}

func frameOf(_ e: AXUIElement) -> Frame? {
  var p: CFTypeRef?
  var s: CFTypeRef?
  var pt = CGPoint.zero
  var sz = CGSize.zero
  guard AXUIElementCopyAttributeValue(e, kAXPositionAttribute as CFString, &p) == .success, p != nil,
        AXValueGetValue(p as! AXValue, .cgPoint, &pt),
        AXUIElementCopyAttributeValue(e, kAXSizeAttribute as CFString, &s) == .success, s != nil,
        AXValueGetValue(s as! AXValue, .cgSize, &sz) else { return nil }
  return Frame(x: Double(pt.x), y: Double(pt.y), w: Double(sz.width), h: Double(sz.height))
}

func settable(_ e: AXUIElement, _ a: String) -> Bool {
  var b = DarwinBoolean(false)
  return AXUIElementIsAttributeSettable(e, a as CFString, &b) == .success && b.boolValue
}

func clip(_ s: String?, _ n: Int) -> String? {
  guard let s = s else { return nil }
  return s.count > n ? String(s.prefix(n)) + "…" : s
}

func appElement(_ pid: Int32) -> AXUIElement {
  let a = AXUIElementCreateApplication(pid)
  _ = AXUIElementSetAttributeValue(a, "AXManualAccessibility" as CFString, kCFBooleanTrue)
  _ = AXUIElementSetAttributeValue(a, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
  return a
}

func targetWindow(_ app: AXUIElement) -> AXUIElement? {
  return elem(app, kAXFocusedWindowAttribute as String) ?? elem(app, kAXMainWindowAttribute as String)
}

func frontPid() -> Int32 { return NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0 }

let fieldRoles: Set<String> = ["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField", "AXDateField",
  "AXTimeField", "AXSecureTextField", "AXPopUpButton", "AXCheckBox", "AXRadioButton", "AXSlider",
  "AXIncrementor", "AXMenuButton", "AXDisclosureTriangle"]
let actionRoles: Set<String> = ["AXButton", "AXLink", "AXTab", "AXCell"]
let textRoles: Set<String> = ["AXStaticText", "AXHeading"]

func labelFor(_ e: AXUIElement) -> String? {
  var parts: [String] = []
  if let t = elem(e, "AXTitleUIElement"), let s = str(t, kAXValueAttribute as String) ?? str(t, kAXTitleAttribute as String) {
    parts.append(s)
  }
  for a in [kAXTitleAttribute as String, kAXDescriptionAttribute as String, kAXHelpAttribute as String] {
    if let s = str(e, a), !parts.contains(s) { parts.append(s) }
  }
  return parts.isEmpty ? nil : clip(parts.joined(separator: " | "), 200)
}

func itemTitle(_ e: AXUIElement) -> String? {
  return str(e, kAXTitleAttribute as String) ?? str(e, kAXValueAttribute as String) ?? str(e, kAXDescriptionAttribute as String)
}

func menuOptions(_ e: AXUIElement) -> [String]? {
  var out: [String] = []
  for c in children(e) {
    if str(c, kAXRoleAttribute as String) == "AXMenu" {
      for item in children(c) {
        if let t = itemTitle(item) { out.append(t) }
        if out.count >= 60 { break }
      }
    }
  }
  return out.isEmpty ? nil : out
}

func runScan(_ input: ScanIn) {
  let pid = (input.pid ?? 0) > 0 ? input.pid! : frontPid()
  let app = appElement(pid)
  let running = NSRunningApplication(processIdentifier: pid)
  let maxEls = input.maxElements ?? 700
  var win = targetWindow(app)
  if win == nil {
    Thread.sleep(forTimeInterval: 0.25)
    win = targetWindow(app)
  }
  guard let w = win else {
    emit(ScanOut(appName: running?.localizedName, bundleId: running?.bundleIdentifier, pid: pid,
      windowTitle: nil, window: nil, elements: [], truncated: false,
      note: "The app exposes no Accessibility window. Use screenshot, click and type_text."))
    return
  }
  var els: [Element] = []
  var visited = 0
  var truncated = false
  var textCount = 0
  let winFrame = frameOf(w)

  func walk(_ e: AXUIElement, _ path: String, _ depth: Int) {
    if els.count >= maxEls || visited >= 9000 { truncated = true; return }
    visited += 1
    let role = str(e, kAXRoleAttribute as String) ?? ""
    let subrole = str(e, kAXSubroleAttribute as String)
    let f = frameOf(e)
    let visible: Bool = {
      guard let f = f, let wf = winFrame else { return true }
      return f.w > 0 && f.h > 0 && f.x + f.w > wf.x - 4 && f.y + f.h > wf.y - 4 && f.x < wf.x + wf.w + 4 && f.y < wf.y + wf.h + 2000
    }()
    if visible && (fieldRoles.contains(role) || subrole == "AXSecureTextField") {
      let secure = subrole == "AXSecureTextField"
      els.append(Element(id: path, role: role, subrole: subrole, label: labelFor(e),
        value: secure ? nil : clip(str(e, kAXValueAttribute as String), 300),
        placeholder: clip(str(e, kAXPlaceholderValueAttribute as String), 120), frame: f,
        enabled: bool(e, kAXEnabledAttribute as String), focused: bool(e, kAXFocusedAttribute as String),
        secure: secure, settable: settable(e, kAXValueAttribute as String),
        options: role == "AXPopUpButton" || role == "AXComboBox" ? menuOptions(e) : nil))
    } else if visible && actionRoles.contains(role) {
      let label = labelFor(e) ?? clip(str(e, kAXValueAttribute as String), 120)
      if label != nil || role == "AXCell" {
        els.append(Element(id: path, role: role, subrole: subrole, label: label,
          value: role == "AXCell" ? clip(str(e, kAXValueAttribute as String), 120) : nil, placeholder: nil,
          frame: f, enabled: bool(e, kAXEnabledAttribute as String), focused: nil, secure: nil, settable: nil, options: nil))
      }
    } else if visible && textRoles.contains(role) && textCount < 350 {
      if let t = str(e, kAXValueAttribute as String) ?? str(e, kAXTitleAttribute as String) ?? str(e, kAXDescriptionAttribute as String) {
        textCount += 1
        els.append(Element(id: path, role: role, subrole: nil, label: nil, value: clip(t, 200), placeholder: nil,
          frame: f, enabled: nil, focused: nil, secure: nil, settable: nil, options: nil))
      }
    }
    if depth > 60 { return }
    // Text inputs keep their own text runs; their children add nothing a person fills.
    if ["AXTextField", "AXTextArea", "AXComboBox", "AXPopUpButton", "AXSearchField"].contains(role) { return }
    for (i, c) in children(e).enumerated() { walk(c, path + "." + String(i), depth + 1) }
  }

  // In a browser, the page is what gets filled; tabs, toolbars and bookmarks are noise.
  func webArea() -> (AXUIElement, String)? {
    var queue: [(AXUIElement, String)] = [(w, "w")]
    var i = 0
    while i < queue.count && i < 600 {
      let (node, path) = queue[i]
      i += 1
      if str(node, kAXRoleAttribute as String) == "AXWebArea" { return (node, path) }
      for (k, c) in children(node).enumerated() { queue.append((c, path + "." + String(k))) }
    }
    return nil
  }
  func scanAll() {
    els = []; visited = 0; textCount = 0
    if let (web, path) = webArea() { walk(web, path, 0) } else { walk(w, "w", 0) }
  }
  scanAll()
  if els.filter({ fieldRoles.contains($0.role) }).isEmpty && visited < 40 {
    // Chromium and Electron build their tree after the first Accessibility request.
    Thread.sleep(forTimeInterval: 0.6)
    scanAll()
  }
  let fields = els.filter { fieldRoles.contains($0.role) }.count
  emit(ScanOut(appName: running?.localizedName, bundleId: running?.bundleIdentifier, pid: pid,
    windowTitle: str(w, kAXTitleAttribute as String), window: winFrame, elements: els, truncated: truncated,
    note: fields == 0 ? "No Accessibility fields were found in this window. The UI may be custom-drawn (canvas, document, remote screen): use screenshot, click and type_text." : nil))
}

func resolve(_ app: AXUIElement, _ id: String) -> AXUIElement? {
  let parts = id.split(separator: ".")
  guard parts.first == "w", var cur = targetWindow(app) else { return nil }
  for p in parts.dropFirst() {
    guard let i = Int(p) else { return nil }
    let kids = children(cur)
    if i >= kids.count { return nil }
    cur = kids[i]
  }
  return cur
}

let keyCodes: [String: CGKeyCode] = [
  "return": 0x24, "enter": 0x24, "tab": 0x30, "space": 0x31, "delete": 0x33, "backspace": 0x33,
  "escape": 0x35, "esc": 0x35, "left": 0x7B, "right": 0x7C, "down": 0x7D, "up": 0x7E,
  "home": 0x73, "end": 0x77, "pageup": 0x74, "pagedown": 0x79, "forwarddelete": 0x75,
  "a": 0x00, "s": 0x01, "d": 0x02, "f": 0x03, "h": 0x04, "g": 0x05, "z": 0x06, "x": 0x07, "c": 0x08,
  "v": 0x09, "b": 0x0B, "q": 0x0C, "w": 0x0D, "e": 0x0E, "r": 0x0F, "y": 0x10, "t": 0x11,
  "1": 0x12, "2": 0x13, "3": 0x14, "4": 0x15, "6": 0x16, "5": 0x17, "9": 0x19, "7": 0x1A, "8": 0x1C,
  "0": 0x1D, "o": 0x1F, "u": 0x20, "i": 0x22, "p": 0x23, "l": 0x25, "j": 0x26, "k": 0x28, "n": 0x2D, "m": 0x2E,
]

let src = CGEventSource(stateID: .hidSystemState)

func flagsFor(_ mods: [String]?) -> CGEventFlags {
  var f: CGEventFlags = []
  for m in mods ?? [] {
    switch m.lowercased() {
    case "cmd", "command", "meta": f.insert(.maskCommand)
    case "shift": f.insert(.maskShift)
    case "alt", "option", "opt": f.insert(.maskAlternate)
    case "ctrl", "control": f.insert(.maskControl)
    default: break
    }
  }
  return f
}

func key(_ code: CGKeyCode, _ flags: CGEventFlags = []) {
  for down in [true, false] {
    guard let ev = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: down) else { continue }
    ev.flags = flags
    ev.post(tap: .cghidEventTap)
  }
  Thread.sleep(forTimeInterval: 0.03)
}

func click(_ x: Double, _ y: Double, _ count: Int = 1) {
  let p = CGPoint(x: x, y: y)
  if let mv = CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left) {
    mv.post(tap: .cghidEventTap)
  }
  Thread.sleep(forTimeInterval: 0.03)
  for n in 1...max(1, count) {
    for t in [CGEventType.leftMouseDown, CGEventType.leftMouseUp] {
      guard let ev = CGEvent(mouseEventSource: src, mouseType: t, mouseCursorPosition: p, mouseButton: .left) else { continue }
      ev.setIntegerValueField(.mouseEventClickState, value: Int64(n))
      ev.post(tap: .cghidEventTap)
    }
    Thread.sleep(forTimeInterval: 0.04)
  }
  Thread.sleep(forTimeInterval: 0.08)
}

let pb = NSPasteboard.general
let concealed = NSPasteboard.PasteboardType("org.nspasteboard.ConcealedType")
let transient = NSPasteboard.PasteboardType("org.nspasteboard.TransientType")
let autoGen = NSPasteboard.PasteboardType("org.nspasteboard.AutoGeneratedType")
var pbSnapshot: [[(NSPasteboard.PasteboardType, Data)]]? = nil
var lastChange: Int? = nil

func snapshotPasteboard() {
  if pbSnapshot != nil { return }
  var snap: [[(NSPasteboard.PasteboardType, Data)]] = []
  for item in pb.pasteboardItems ?? [] {
    var pairs: [(NSPasteboard.PasteboardType, Data)] = []
    for t in item.types { if let d = item.data(forType: t) { pairs.append((t, d)) } }
    if !pairs.isEmpty { snap.append(pairs) }
  }
  pbSnapshot = snap
}

func restorePasteboard() {
  guard let snap = pbSnapshot, let expected = lastChange else { return }
  Thread.sleep(forTimeInterval: 0.15)
  if pb.changeCount != expected { return }
  pb.clearContents()
  if !snap.isEmpty {
    pb.writeObjects(snap.map { pairs in
      let it = NSPasteboardItem()
      for (t, d) in pairs { it.setData(d, forType: t) }
      return it
    })
  }
}

func paste(_ text: String) {
  snapshotPasteboard()
  pb.clearContents()
  pb.setString(text, forType: .string)
  pb.setData(Data(), forType: concealed)
  pb.setData(Data(), forType: transient)
  pb.setData(Data(), forType: autoGen)
  lastChange = pb.changeCount
  key(0x09, .maskCommand)
  Thread.sleep(forTimeInterval: 0.09)
}

func norm(_ s: String?) -> String {
  return (s ?? "").lowercased().components(separatedBy: CharacterSet.alphanumerics.inverted).joined()
}

func matches(_ e: AXUIElement, _ value: String) -> Bool {
  let got = norm(str(e, kAXValueAttribute as String))
  let want = norm(value)
  if want.isEmpty { return got.isEmpty }
  return got == want || got.contains(want)
}

func focusApp(_ pid: Int32) {
  if frontPid() == pid { return }
  NSRunningApplication(processIdentifier: pid)?.activate(options: [])
  for _ in 0..<20 {
    if frontPid() == pid { break }
    Thread.sleep(forTimeInterval: 0.05)
  }
  Thread.sleep(forTimeInterval: 0.12)
}

func fill(_ app: AXUIElement, _ e: AXUIElement, _ value: String) -> OpResult {
  let role = str(e, kAXRoleAttribute as String) ?? ""
  let secure = str(e, kAXSubroleAttribute as String) == "AXSecureTextField"
  func done(_ m: String) -> OpResult {
    return OpResult(op: "fill", id: nil, ok: true, method: m, readback: secure ? nil : clip(str(e, kAXValueAttribute as String), 300), error: nil)
  }
  if role == "AXPopUpButton" { return select(app, e, value) }
  // 1. Focus through Accessibility, then select-all + paste so the app sees real input events.
  _ = AXUIElementSetAttributeValue(e, kAXFocusedAttribute as CFString, kCFBooleanTrue)
  Thread.sleep(forTimeInterval: 0.06)
  if bool(e, kAXFocusedAttribute as String) == true {
    key(0x00, .maskCommand)
    paste(value)
    if secure || matches(e, value) { return done("paste") }
  }
  // 2. Click the field itself, then paste.
  if let f = frameOf(e), f.w > 0, f.h > 0 {
    click(f.x + min(f.w / 2, 40), f.y + f.h / 2)
    key(0x00, .maskCommand)
    paste(value)
    if secure || matches(e, value) { return done("click+paste") }
  }
  // 3. Write the value directly.
  if settable(e, kAXValueAttribute as String) {
    _ = AXUIElementSetAttributeValue(e, kAXValueAttribute as CFString, value as CFString)
    Thread.sleep(forTimeInterval: 0.05)
    if matches(e, value) { return done("setValue") }
  }
  return OpResult(op: "fill", id: nil, ok: false, method: nil, readback: clip(str(e, kAXValueAttribute as String), 300),
    error: "The value did not stick. Check with screenshot and use click + type_text.")
}

func findMenuItem(_ root: AXUIElement, _ want: String, _ depth: Int) -> AXUIElement? {
  if depth > 6 { return nil }
  for c in children(root) {
    let role = str(c, kAXRoleAttribute as String) ?? ""
    if role == "AXMenuItem" {
      let t = itemTitle(c) ?? ""
      if norm(t) == norm(want) { return c }
    }
    if let hit = findMenuItem(c, want, depth + 1) { return hit }
  }
  return nil
}

func findMenuItemLoose(_ root: AXUIElement, _ want: String, _ depth: Int) -> AXUIElement? {
  if depth > 6 { return nil }
  for c in children(root) {
    if str(c, kAXRoleAttribute as String) == "AXMenuItem" {
      let t = norm(itemTitle(c))
      if !t.isEmpty && (t.contains(norm(want)) || norm(want).contains(t)) { return c }
    }
    if let hit = findMenuItemLoose(c, want, depth + 1) { return hit }
  }
  return nil
}

func select(_ app: AXUIElement, _ e: AXUIElement, _ value: String) -> OpResult {
  if matches(e, value) {
    return OpResult(op: "select", id: nil, ok: true, method: "already", readback: str(e, kAXValueAttribute as String), error: nil)
  }
  _ = AXUIElementPerformAction(e, kAXPressAction as CFString)
  Thread.sleep(forTimeInterval: 0.3)
  let item = findMenuItem(e, value, 0) ?? findMenuItemLoose(e, value, 0) ?? findMenuItem(app, value, 0)
  if let item = item {
    _ = AXUIElementPerformAction(item, kAXPressAction as CFString)
    Thread.sleep(forTimeInterval: 0.15)
    return OpResult(op: "select", id: nil, ok: true, method: "menu", readback: str(e, kAXValueAttribute as String), error: nil)
  }
  key(0x35)
  // Web <select> menus are often not exposed; typing the option text selects it while focused.
  _ = AXUIElementSetAttributeValue(e, kAXFocusedAttribute as CFString, kCFBooleanTrue)
  if settable(e, kAXValueAttribute as String) {
    _ = AXUIElementSetAttributeValue(e, kAXValueAttribute as CFString, value as CFString)
    Thread.sleep(forTimeInterval: 0.1)
    if matches(e, value) {
      return OpResult(op: "select", id: nil, ok: true, method: "setValue", readback: str(e, kAXValueAttribute as String), error: nil)
    }
  }
  return OpResult(op: "select", id: nil, ok: false, method: nil, readback: str(e, kAXValueAttribute as String),
    error: "Option not found. Open it with click, then screenshot and click the option.")
}

func runAct(_ input: ActIn) {
  let app = appElement(input.pid)
  focusApp(input.pid)
  var results: [OpResult] = []
  for op in input.ops {
    func fail(_ msg: String) { results.append(OpResult(op: op.op, id: op.id, ok: false, method: nil, readback: nil, error: msg)) }
    switch op.op {
    case "fill", "select", "press", "focus", "read":
      guard let id = op.id, let e = resolve(app, id) else { fail("Element not found; read_window again for fresh ids."); continue }
      switch op.op {
      case "fill":
        let r = fill(app, e, op.value ?? "")
        results.append(OpResult(op: "fill", id: id, ok: r.ok, method: r.method, readback: r.readback, error: r.error))
      case "select":
        let r = select(app, e, op.value ?? "")
        results.append(OpResult(op: "select", id: id, ok: r.ok, method: r.method, readback: r.readback, error: r.error))
      case "press":
        var ok = AXUIElementPerformAction(e, kAXPressAction as CFString) == .success
        if !ok, let f = frameOf(e) { click(f.x + f.w / 2, f.y + f.h / 2); ok = true }
        Thread.sleep(forTimeInterval: 0.12)
        results.append(OpResult(op: "press", id: id, ok: ok, method: nil, readback: str(e, kAXValueAttribute as String), error: nil))
      case "focus":
        let ok = AXUIElementSetAttributeValue(e, kAXFocusedAttribute as CFString, kCFBooleanTrue) == .success
        results.append(OpResult(op: "focus", id: id, ok: ok, method: nil, readback: nil, error: nil))
      default:
        results.append(OpResult(op: "read", id: id, ok: true, method: nil, readback: str(e, kAXValueAttribute as String), error: nil))
      }
    case "click":
      guard let x = op.x, let y = op.y else { fail("x and y are required"); continue }
      click(x, y, op.count ?? 1)
      results.append(OpResult(op: "click", id: nil, ok: true, method: nil, readback: nil, error: nil))
    case "type":
      paste(op.value ?? "")
      results.append(OpResult(op: "type", id: nil, ok: true, method: nil, readback: nil, error: nil))
    case "key":
      guard let k = op.key?.lowercased(), let code = keyCodes[k] else { fail("Unknown key"); continue }
      for _ in 0..<max(1, op.count ?? 1) { key(code, flagsFor(op.modifiers)) }
      results.append(OpResult(op: "key", id: nil, ok: true, method: nil, readback: nil, error: nil))
    case "scroll":
      if let x = op.x, let y = op.y,
         let mv = CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: CGPoint(x: x, y: y), mouseButton: .left) {
        mv.post(tap: .cghidEventTap)
      }
      if let ev = CGEvent(scrollWheelEvent2Source: src, units: .pixel, wheelCount: 2,
                          wheel1: Int32(-(op.dy ?? 0)), wheel2: Int32(-(op.dx ?? 0)), wheel3: 0) {
        ev.post(tap: .cghidEventTap)
      }
      Thread.sleep(forTimeInterval: 0.25)
      results.append(OpResult(op: "scroll", id: nil, ok: true, method: nil, readback: nil, error: nil))
    case "wait":
      Thread.sleep(forTimeInterval: min(5, max(0.05, (op.dy ?? 500) / 1000)))
      results.append(OpResult(op: "wait", id: nil, ok: true, method: nil, readback: nil, error: nil))
    default:
      fail("Unknown op")
    }
  }
  restorePasteboard()
  emit(results)
}

func runWindow(_ input: ScanIn) {
  let pid = (input.pid ?? 0) > 0 ? input.pid! : frontPid()
  let app = appElement(pid)
  let w = targetWindow(app)
  let f = w.flatMap { frameOf($0) }
  var number: Int? = nil
  if let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] {
    var best: (Int, Double)? = nil
    for info in list {
      guard (info[kCGWindowOwnerPID as String] as? Int32) == pid,
            (info[kCGWindowLayer as String] as? Int) == 0,
            let n = info[kCGWindowNumber as String] as? Int,
            let b = info[kCGWindowBounds as String] as? [String: Double] else { continue }
      let bx = b["X"] ?? 0, by = b["Y"] ?? 0, bw = b["Width"] ?? 0, bh = b["Height"] ?? 0
      let d: Double = f.map { abs($0.x - bx) + abs($0.y - by) + abs($0.w - bw) + abs($0.h - bh) } ?? -(bw * bh)
      if best == nil || d < best!.1 { best = (n, d) }
    }
    number = best?.0
  }
  emit(WindowOut(pid: pid, frame: f, windowNumber: number, title: w.flatMap { str($0, kAXTitleAttribute as String) }))
}

func emit<T: Encodable>(_ v: T) {
  if let d = try? JSONEncoder().encode(v), let s = String(data: d, encoding: .utf8) { print(s) } else { print("{}") }
}

let mode = CommandLine.arguments.dropFirst().first ?? "scan"
let data = FileHandle.standardInput.readDataToEndOfFile()
switch mode {
case "act":
  if let input = try? JSONDecoder().decode(ActIn.self, from: data) { runAct(input) } else { print("[]") }
case "window":
  runWindow((try? JSONDecoder().decode(ScanIn.self, from: data)) ?? ScanIn(pid: nil, maxElements: nil))
default:
  runScan((try? JSONDecoder().decode(ScanIn.self, from: data)) ?? ScanIn(pid: nil, maxElements: nil))
}
`;
