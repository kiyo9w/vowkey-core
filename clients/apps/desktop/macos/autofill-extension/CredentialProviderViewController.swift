//
//  CredentialProviderViewController.swift
//  autofill-extension
//
//  Created by Andreas Coroiu on 2023-12-21.
//

import AppKit
import AuthenticationServices
import os

class CredentialProviderViewController: ASCredentialProviderViewController {
    let logger: Logger

    @IBOutlet weak var statusLabel: NSTextField!
    @IBOutlet weak var logoImageView: NSImageView!

    // The IPC client to communicate with the Vowkey desktop app
    private var client: AutofillProviderClient?

    // Timer for checking connection status
    private var connectionMonitorTimer: Timer?
    private var lastConnectionStatus: ConnectionStatus = .disconnected

    // Correlation ID for the request currently being handled by the desktop app,
    // if any. Used to cancel that request when this view controller is torn down
    // before the request completes (e.g. the user dismisses the system UI).
    // Guarded by `requestLock` because host callbacks fire on foreign threads
    // while the view lifecycle runs on the main thread.
    private let requestLock = NSLock()
    private var inFlightRequestContext: String?

    // Records that a request has been sent to the desktop app so that teardown
    // can cancel it if it hasn't completed yet.
    private func beginRequest(_ context: String) {
        requestLock.lock()
        inFlightRequestContext = context
        requestLock.unlock()
    }

    // Marks the in-flight request as finished so teardown won't cancel it.
    // Called from the completion/error callbacks.
    private func finishRequest() {
        requestLock.lock()
        inFlightRequestContext = nil
        requestLock.unlock()
    }

    // Atomically clears and returns the in-flight context, if any, so that the
    // caller can cancel it exactly once.
    private func takeInFlightContext() -> String? {
        requestLock.lock()
        defer { requestLock.unlock() }
        let context = inFlightRequestContext
        inFlightRequestContext = nil
        return context
    }

    // We changed the getClient method to be async, here's why:
    // This is so that we can check if the app is running, and launch it, without blocking the main thread
    // Blocking the main thread caused MacOS layouting to 'fail' or at least be very delayed, which caused our getWindowPositioning code to sent 0,0.
    // We also properly retry the IPC connection which sometimes would take some time to be up and running, depending on CPU load, phase of jupiters moon, etc.
    private func getClient() async -> AutofillProviderClient {
        if let client = self.client {
            return client
        }

        initializeLogging()
        let logger = Logger(subsystem: "com.vowkey.desktop.autofill-extension", category: "credential-provider")

        // The app that contains this extension, derived from the extension's own location:
        // <App>.app/Contents/PlugIns/<extension>.appex. Resolving it by path rather than by
        // bundle identifier keeps the beta and stable channels apart without hardcoding
        // either one, and stops a stale copy of the app registered elsewhere on the system
        // from being launched in place of the real container.
        let containerURL = Bundle.main.bundleURL
            .deletingLastPathComponent() // PlugIns
            .deletingLastPathComponent() // Contents
            .deletingLastPathComponent() // <App>.app
            .resolvingSymlinksInPath()

        // Check if the Electron app is running
        let workspace = NSWorkspace.shared
        let isRunning = workspace.runningApplications.contains { app in
            app.bundleURL?.resolvingSymlinksInPath() == containerURL
        }

        if !isRunning {
            logger.log("[autofill-extension] Vowkey Desktop not running, attempting to launch \(containerURL.path, privacy: .public)")

            // Launch the app and wait for it to be ready
            await withCheckedContinuation { continuation in
                workspace.openApplication(at: containerURL, configuration: NSWorkspace.OpenConfiguration()) { app, error in
                    if let error = error {
                        logger.error("[autofill-extension] Failed to launch Vowkey Desktop: \(error.localizedDescription)")
                    } else {
                        logger.log("[autofill-extension] Successfully launched Vowkey Desktop")
                    }
                    continuation.resume()
                }
            }
        }

        logger.log("[autofill-extension] Connecting to Vowkey over IPC")

        // Retry connecting to the Vowkey IPC with an increasing delay
        let maxRetries = 20
        let delayMs = 500
        var newClient: AutofillProviderClient?

        for attempt in 1...maxRetries {
            logger.log("[autofill-extension] Connection attempt \(attempt)")

            // Create a new client instance for each retry
            newClient = AutofillProviderClient.connect()
            try? await Task.sleep(nanoseconds: UInt64(100 * attempt + (delayMs * 1_000_000))) // Convert ms to nanoseconds
            let connectionStatus = newClient!.getConnectionStatus()

            let statusString = switch connectionStatus {
                case .connecting: "connecting"
                case .connected: "connected"
                case .disconnected: "disconnected"
            }
            logger.log("[autofill-extension] Connection attempt \(attempt), status: \(statusString)")

            if connectionStatus == .connected {
                logger.log("[autofill-extension] Successfully connected to Vowkey (attempt \(attempt))")
                break
            } else if connectionStatus == .connecting {
                // try to wait one more time while it's connecting
                try? await Task.sleep(for: .milliseconds(100))
                if newClient!.getConnectionStatus() == .connected {
                    break
                }
            }

            // client couldn't connect in deadline.
            if attempt < maxRetries {
                logger.log("[autofill-extension] Retrying connection")
            } else {
                logger.error("[autofill-extension] Failed to connect after \(maxRetries) attempts, final status: \(statusString)")
            }
        }

        self.client = newClient
        return newClient!
    }

    // Setup the connection monitoring timer
    private func setupConnectionMonitoring() {
        // Check connection status every 1 second
        connectionMonitorTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.checkConnectionStatus()
        }

        // Make sure timer runs even when UI is busy
        RunLoop.current.add(connectionMonitorTimer!, forMode: .common)

        // Initial check
        checkConnectionStatus()
    }

    // Check the connection status by calling into Rust
    // If the connection is has changed and is now disconnected, cancel the request
    private func checkConnectionStatus() {
        // Only check connection status if the client has been initialized.
        // Initialization is done asynchronously, so we might be called before it's ready
        // In that case we just skip this check and wait for the next timer tick and re-check
        guard let client = self.client else {
            return
        }

        // Get the current connection status from Rust
        let currentStatus = client.getConnectionStatus()

        // Only post notification if state changed
        if currentStatus != lastConnectionStatus {
            if(currentStatus == .connected) {
                logger.log("[autofill-extension] Connection status changed: Connected")
            } else {
                logger.log("[autofill-extension] Connection status changed: Disconnected")
            }

            // Save the new status
            lastConnectionStatus = currentStatus

            // If we just disconnected, try to cancel the request
            if currentStatus == .disconnected {
                self.extensionContext.cancelRequest(withError: VowkeyError.Disconnected)
            }
        }
    }

    init() {
        logger = Logger(subsystem: "com.vowkey.desktop.autofill-extension", category: "credential-provider")

        logger.log("[autofill-extension] initializing extension")

        super.init(nibName: "CredentialProviderViewController", bundle: nil)

        // Setup connection monitoring now that self is available
        setupConnectionMonitoring()
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    deinit {
        logger.log("[autofill-extension] deinitializing extension")

        // Stop the connection monitor timer
        connectionMonitorTimer?.invalidate()
        connectionMonitorTimer = nil
    }

    private func getWindowDetails() async -> WindowDetails {
        let screenHeight = NSScreen.main?.frame.height ?? 1440

        logger.log("[autofill-extension] position: Getting window position")

        // To whomever is reading this. Sorry. But MacOS couldn't give us an accurate window positioning, possibly due to animations
        // So I added some retry logic, as well as a fall back to the mouse position which is likely at the sort of the right place.
        // In my testing we often succeed after 4-7 attempts.
        // Wait for window frame to stabilize (animation to complete)
        var lastFrame: CGRect = .zero
        var stableCount = 0
        let requiredStableChecks = 3
        let maxAttempts = 20
        var attempts = 0

        while stableCount < requiredStableChecks && attempts < maxAttempts {
            let currentFrame: CGRect = self.view.window?.frame ?? .zero

            if currentFrame.equalTo(lastFrame) && !currentFrame.equalTo(.zero) {
                stableCount += 1
            } else {
                stableCount = 0
                lastFrame = currentFrame
            }

            try? await Task.sleep(nanoseconds: 16_666_666) // ~60fps (16.67ms)
            attempts += 1
        }

        let x, y: Int32
        let finalWindowFrame = self.view.window?.frame ?? .zero
        logger.log("[autofill-extension] position: Final window frame: \(NSStringFromRect(finalWindowFrame))")

        // Use stabilized window frame if available, otherwise fallback to mouse position
        if finalWindowFrame.origin.x != 0 || finalWindowFrame.origin.y != 0 {
            let centerX = Int32(round(finalWindowFrame.origin.x))
            let centerY = Int32(round(screenHeight - finalWindowFrame.origin.y))
            logger.log("[autofill-extension] position: Using window position: x=\(centerX), y=\(centerY)")
            x = centerX
            y = centerY
        } else {
            // Fallback to mouse position
            let mouseLocation = NSEvent.mouseLocation
            let mouseX = Int32(round(mouseLocation.x))
            let mouseY = Int32(round(screenHeight - mouseLocation.y))
            logger.log("[autofill-extension] position: Using mouse position fallback: x=\(mouseX), y=\(mouseY)")
            x = mouseX
            y = mouseY
        }
        // Add 100 pixels to the x-coordinate to offset the native OS dialog positioning.
        return WindowDetails(position: Position(x: x + 100, y: y), handle: nil)
    }

    override func viewDidLoad() {
        super.viewDidLoad()

        // Initially hide the view
        self.view.isHidden = true
    }

    // Notify the desktop app that an unfinished request should be cancelled. `takeInFlightContext()` returns
    // nil once a request has completed, so normal completion doesn't cancel.
    //
    // This method is called after `completeRequest` or `cancelRequest`, or if
    // the system UI is torn down when the user dismisses the sheet. Because of
    // that, this should be called at every terminal point in the extension's
    // flow.
    override func viewWillDisappear() {
        super.viewWillDisappear()

        if let context = takeInFlightContext() {
            logger.log("[autofill-extension] View disappearing with in-flight request, cancelling \(context)")
            self.client?.cancelRequest(context: context)
        }
    }

    private var pickerCredentials: [PasswordCredentialRecord] = []
    private var pickerFiltered: [PasswordCredentialRecord] = []
    private var pickerRowsStack: NSStackView?
    private var pickerSearchField: NSSearchField?
    private var pickerContainerView: NSView?

    private func ensureDesktopRunningAndSync() async {
        _ = await getClient()
        await syncPasswordIdentitiesToSystemStore()
    }

    private func syncPasswordIdentitiesToSystemStore() async {
        let records: [PasswordCredentialRecord] = await Task.detached {
            (try? listPasswordCredentials(serviceIdentifiers: [])) ?? []
        }.value

        guard !records.isEmpty else { return }

        var identities: [ASCredentialIdentity] = []
        for record in records {
            guard !record.serviceIdentifier.isEmpty, !record.username.isEmpty else { continue }
            let serviceType: ASCredentialServiceIdentifier.IdentifierType =
                record.serviceIdentifier.contains("://") ? .URL : .domain
            let serviceId = ASCredentialServiceIdentifier(
                identifier: record.serviceIdentifier,
                type: serviceType
            )
            let passwordIdentity = ASPasswordCredentialIdentity(
                serviceIdentifier: serviceId,
                user: record.username,
                recordIdentifier: record.recordIdentifier
            )
            identities.append(passwordIdentity)

            if #available(macOSApplicationExtension 15.0, *),
               let totp = record.totp,
               !totp.isEmpty
            {
                let otcIdentity = ASOneTimeCodeCredentialIdentity(
                    serviceIdentifier: serviceId,
                    label: record.title.isEmpty ? record.username : record.title,
                    recordIdentifier: record.recordIdentifier
                )
                identities.append(otcIdentity)
            }
        }

        guard !identities.isEmpty else { return }

        let store = ASCredentialIdentityStore.shared
        let state = await store.state()
        guard state.isEnabled else { return }
        do {
            if #available(macOSApplicationExtension 14.0, *) {
                try await store.saveCredentialIdentities(identities)
            }
        } catch {
            logger.error("[autofill-extension] Failed saving password identities: \(error.localizedDescription)")
        }
    }

    override func prepareInterfaceForExtensionConfiguration() {
        // Show the configuration UI
        self.view.isHidden = false

        // Set the localized message
        statusLabel?.stringValue = NSLocalizedString("autofillConfigurationMessage", comment: "Message shown when Vowkey is enabled in system settings")

        // Send the native status request and populate ASCredentialIdentityStore asynchronously
        Task {
            let client = await getClient()
            client.sendNativeStatus(key: "request-sync", value: "")
            await syncPasswordIdentitiesToSystemStore()
        }

        // Complete the configuration after 2 seconds
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
            self?.extensionContext.completeExtensionConfigurationRequest()
        }
    }

    override func provideCredentialWithoutUserInteraction(for credentialRequest: any ASCredentialRequest) {
        if let passwordRequest = credentialRequest as? ASPasswordCredentialRequest,
           let identity = passwordRequest.credentialIdentity as? ASPasswordCredentialIdentity,
           let recordId = identity.recordIdentifier
        {
            Task.detached { [weak self] in
                guard let self = self else { return }
                do {
                    let record = try fetchPasswordCredential(recordIdentifier: recordId)
                    guard let password = record.password else {
                        self.extensionContext.cancelRequest(withError: ASExtensionError(.credentialIdentityNotFound))
                        return
                    }
                    let credential = ASPasswordCredential(user: record.username, password: password)
                    self.extensionContext.completeRequest(withSelectedCredential: credential, completionHandler: nil)
                } catch VowkeyError.CredentialNotFound {
                    self.extensionContext.cancelRequest(withError: ASExtensionError(.credentialIdentityNotFound))
                } catch {
                    self.extensionContext.cancelRequest(withError: ASExtensionError(.userInteractionRequired))
                }
            }
            return
        }

        if #available(macOSApplicationExtension 15.0, *),
           let otcRequest = credentialRequest as? ASOneTimeCodeCredentialRequest,
           let identity = otcRequest.credentialIdentity as? ASOneTimeCodeCredentialIdentity,
           let recordId = identity.recordIdentifier
        {
            Task.detached { [weak self] in
                guard let self = self else { return }
                do {
                    let record = try fetchPasswordCredential(recordIdentifier: recordId)
                    guard let code = record.totp, !code.isEmpty else {
                        self.extensionContext.cancelRequest(withError: ASExtensionError(.credentialIdentityNotFound))
                        return
                    }
                    await self.extensionContext.completeOneTimeCodeRequest(using: ASOneTimeCodeCredential(code: code))
                } catch VowkeyError.CredentialNotFound {
                    self.extensionContext.cancelRequest(withError: ASExtensionError(.credentialIdentityNotFound))
                } catch {
                    self.extensionContext.cancelRequest(withError: ASExtensionError(.userInteractionRequired))
                }
            }
            return
        }

        let error = ASExtensionError(.userInteractionRequired)
        self.extensionContext.cancelRequest(withError: error)
    }

    override func prepareInterfaceToProvideCredential(for credentialRequest: ASCredentialRequest) {
        let timeoutTimer = createTimer()

        if let passwordRequest = credentialRequest as? ASPasswordCredentialRequest,
           let identity = passwordRequest.credentialIdentity as? ASPasswordCredentialIdentity,
           let recordId = identity.recordIdentifier
        {
            Task { @MainActor in
                await self.ensureDesktopRunningAndSync()
                do {
                    let record = try await Task.detached {
                        try fetchPasswordCredential(recordIdentifier: recordId)
                    }.value
                    timeoutTimer.cancel()
                    if let password = record.password {
                        let credential = ASPasswordCredential(user: record.username, password: password)
                        self.extensionContext.completeRequest(withSelectedCredential: credential, completionHandler: nil)
                    } else {
                        self.extensionContext.cancelRequest(withError: ASExtensionError(.credentialIdentityNotFound))
                    }
                } catch VowkeyError.CredentialNotFound {
                    timeoutTimer.cancel()
                    self.extensionContext.cancelRequest(withError: ASExtensionError(.credentialIdentityNotFound))
                } catch {
                    self.presentUnlockPromptForRecord(recordId: recordId, isOneTimeCode: false, timeoutTimer: timeoutTimer)
                }
            }
            return
        }

        if #available(macOSApplicationExtension 15.0, *),
           let otcRequest = credentialRequest as? ASOneTimeCodeCredentialRequest,
           let identity = otcRequest.credentialIdentity as? ASOneTimeCodeCredentialIdentity,
           let recordId = identity.recordIdentifier
        {
            Task { @MainActor in
                await self.ensureDesktopRunningAndSync()
                do {
                    let record = try await Task.detached {
                        try fetchPasswordCredential(recordIdentifier: recordId)
                    }.value
                    timeoutTimer.cancel()
                    if let code = record.totp, !code.isEmpty {
                        await self.extensionContext.completeOneTimeCodeRequest(using: ASOneTimeCodeCredential(code: code))
                    } else {
                        self.extensionContext.cancelRequest(withError: ASExtensionError(.credentialIdentityNotFound))
                    }
                } catch VowkeyError.CredentialNotFound {
                    timeoutTimer.cancel()
                    self.extensionContext.cancelRequest(withError: ASExtensionError(.credentialIdentityNotFound))
                } catch {
                    self.presentUnlockPromptForRecord(recordId: recordId, isOneTimeCode: true, timeoutTimer: timeoutTimer)
                }
            }
            return
        }

        if let request = credentialRequest as? ASPasskeyCredentialRequest {
            if let passkeyIdentity = request.credentialIdentity as? ASPasskeyCredentialIdentity {

                logger.log("[autofill-extension] prepareInterfaceToProvideCredential (passkey) called \(request)")

                class CallbackImpl: PreparePasskeyAssertionCallback {
                    let ctx: ASCredentialProviderExtensionContext
                    let logger: Logger
                    let timeoutTimer: DispatchWorkItem
                    let onFinish: () -> Void
                    required init(_ ctx: ASCredentialProviderExtensionContext,_ logger: Logger, _ timeoutTimer: DispatchWorkItem, _ onFinish: @escaping () -> Void) {
                        self.ctx = ctx
                        self.logger = logger
                        self.timeoutTimer = timeoutTimer
                        self.onFinish = onFinish
                    }

                    func onComplete(credential: PasskeyAssertionResponse) {
                        self.onFinish()
                        self.timeoutTimer.cancel()
                        ctx.completeAssertionRequest(using: ASPasskeyAssertionCredential(
                            userHandle: credential.userHandle,
                            relyingParty: credential.rpId,
                            signature: credential.signature,
                            clientDataHash: credential.clientDataHash,
                            authenticatorData: credential.authenticatorData,
                            credentialID: credential.credentialId
                        ))
                    }

                    func onError(error: VowkeyError) {
                        self.onFinish()
                        logger.error("[autofill-extension] OnError called, cancelling the request \(error)")
                        self.timeoutTimer.cancel()
                        if case .CredentialNotFound = error {
                            ctx.cancelRequest(withError: ASExtensionError(.credentialIdentityNotFound))
                        } else {
                            ctx.cancelRequest(withError: error)
                        }
                    }
                }

                let userVerification = switch request.userVerificationPreference {
                case .preferred:
                    UserVerification.preferred
                case .required:
                    UserVerification.required
                default:
                    UserVerification.discouraged
                }

                Task {
                    let clientWindow = await self.getWindowDetails()
                    let context = UUID().uuidString
                    let req = PasskeyAssertionWithoutUserInterfaceRequest(
                        rpId: passkeyIdentity.relyingPartyIdentifier,
                        clientDataHash: request.clientDataHash,
                        userVerification: userVerification,
                        clientWindow: clientWindow,
                        credentialId: passkeyIdentity.credentialID,
                        userName: passkeyIdentity.userName,
                        userHandle: passkeyIdentity.userHandle,
                        recordIdentifier: passkeyIdentity.recordIdentifier,
                        context: context
                    )

                    let client = await getClient()
                    self.beginRequest(context)
                    client.preparePasskeyAssertionWithoutUserInterface(request: req, callback: CallbackImpl(self.extensionContext, self.logger, timeoutTimer, { [weak self] in self?.finishRequest() }))
                }
                return
            }
        }

        timeoutTimer.cancel()
        logger.log("[autofill-extension] prepareInterfaceToProvideCredential unsupported request")
        self.extensionContext.cancelRequest(withError: VowkeyError.Internal("Invalid authentication request"))
    }

    override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        let ids = serviceIdentifiers.map { $0.identifier }
        logger.log("[autofill-extension] prepareCredentialList(password) for \(ids.count) serviceIdentifiers")

        Task { @MainActor in
            await self.ensureDesktopRunningAndSync()
            let (matched, allRecords): ([PasswordCredentialRecord], [PasswordCredentialRecord]) = await Task.detached {
                let m = (try? listPasswordCredentials(serviceIdentifiers: ids)) ?? []
                let all = (try? listPasswordCredentials(serviceIdentifiers: [])) ?? []
                return (m, all)
            }.value

            var seen = Set<String>()
            var combined: [PasswordCredentialRecord] = []
            for item in matched + allRecords {
                if seen.insert(item.recordIdentifier).inserted {
                    combined.append(item)
                }
            }
            self.pickerCredentials = combined
            self.pickerFiltered = combined
            self.buildPasswordPickerUI()
        }
    }

    @MainActor
    private func presentUnlockPromptForRecord(
        recordId: String,
        isOneTimeCode: Bool,
        timeoutTimer: DispatchWorkItem
    ) {
        self.view.isHidden = false
        statusLabel?.stringValue = "Unlock Vowkey to fill this login."
        let retryButton = NSButton(title: "Fill now", target: self, action: #selector(onCancelPicker))
        retryButton.bezelStyle = .rounded

        Task { @MainActor in
            for _ in 0..<60 {
                try? await Task.sleep(for: .milliseconds(500))
                if let record = try? await Task.detached(operation: {
                    try fetchPasswordCredential(recordIdentifier: recordId)
                }).value {
                    timeoutTimer.cancel()
                    if isOneTimeCode {
                        if #available(macOSApplicationExtension 15.0, *),
                           let code = record.totp,
                           !code.isEmpty
                        {
                            await self.extensionContext.completeOneTimeCodeRequest(using: ASOneTimeCodeCredential(code: code))
                            return
                        }
                    } else if let password = record.password {
                        let credential = ASPasswordCredential(user: record.username, password: password)
                        self.extensionContext.completeRequest(withSelectedCredential: credential, completionHandler: nil)
                        return
                    }
                }
            }
        }
    }

    @MainActor
    private func buildPasswordPickerUI() {
        self.view.isHidden = false
        statusLabel?.isHidden = true
        logoImageView?.isHidden = true
        pickerContainerView?.removeFromSuperview()

        let container = NSView()
        container.translatesAutoresizingMaskIntoConstraints = false
        self.view.addSubview(container)
        self.pickerContainerView = container

        NSLayoutConstraint.activate([
            container.leadingAnchor.constraint(equalTo: self.view.leadingAnchor, constant: 16),
            container.trailingAnchor.constraint(equalTo: self.view.trailingAnchor, constant: -16),
            container.topAnchor.constraint(equalTo: self.view.topAnchor, constant: 14),
            container.bottomAnchor.constraint(equalTo: self.view.bottomAnchor, constant: -14),
            self.view.widthAnchor.constraint(greaterThanOrEqualToConstant: 360),
            self.view.heightAnchor.constraint(greaterThanOrEqualToConstant: 300),
        ])

        let header = NSTextField(labelWithString: "Choose a saved login")
        header.font = .systemFont(ofSize: 14, weight: .semibold)
        header.translatesAutoresizingMaskIntoConstraints = false

        let search = NSSearchField()
        search.placeholderString = "Search logins"
        search.target = self
        search.action = #selector(onPickerSearchChanged(_:))
        search.sendsSearchStringImmediately = true
        search.translatesAutoresizingMaskIntoConstraints = false
        self.pickerSearchField = search

        let scrollView = NSScrollView()
        scrollView.hasVerticalScroller = true
        scrollView.drawsBackground = false
        scrollView.translatesAutoresizingMaskIntoConstraints = false

        let rowsStack = NSStackView()
        rowsStack.orientation = .vertical
        rowsStack.alignment = .leading
        rowsStack.spacing = 6
        rowsStack.translatesAutoresizingMaskIntoConstraints = false
        scrollView.documentView = rowsStack
        self.pickerRowsStack = rowsStack

        let cancelButton = NSButton(title: "Cancel", target: self, action: #selector(onCancelPicker))
        cancelButton.bezelStyle = .rounded
        cancelButton.keyEquivalent = "\u{1b}"
        cancelButton.translatesAutoresizingMaskIntoConstraints = false

        container.addSubview(header)
        container.addSubview(search)
        container.addSubview(scrollView)
        container.addSubview(cancelButton)

        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: container.topAnchor),
            header.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            header.trailingAnchor.constraint(equalTo: container.trailingAnchor),

            search.topAnchor.constraint(equalTo: header.bottomAnchor, constant: 8),
            search.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            search.trailingAnchor.constraint(equalTo: container.trailingAnchor),

            scrollView.topAnchor.constraint(equalTo: search.bottomAnchor, constant: 10),
            scrollView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            scrollView.bottomAnchor.constraint(equalTo: cancelButton.topAnchor, constant: -10),

            rowsStack.widthAnchor.constraint(equalTo: scrollView.widthAnchor),

            cancelButton.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            cancelButton.bottomAnchor.constraint(equalTo: container.bottomAnchor),
        ])

        renderPickerRows()
    }

    @MainActor
    private func renderPickerRows() {
        guard let stack = self.pickerRowsStack else { return }
        for subview in stack.arrangedSubviews {
            stack.removeArrangedSubview(subview)
            subview.removeFromSuperview()
        }

        if pickerFiltered.isEmpty {
            let emptyLabel = NSTextField(labelWithString: "No matching saved logins in Vowkey.")
            emptyLabel.textColor = .secondaryLabelColor
            emptyLabel.font = .systemFont(ofSize: 12)
            stack.addArrangedSubview(emptyLabel)
            return
        }

        for (index, item) in pickerFiltered.enumerated() {
            let titleText = item.title.isEmpty ? item.serviceIdentifier : item.title
            let subtitleText = [item.username, item.serviceIdentifier]
                .filter { !$0.isEmpty }
                .joined(separator: " · ")
            let button = NSButton(
                title: subtitleText.isEmpty ? titleText : "\(titleText) — \(subtitleText)",
                target: self,
                action: #selector(onSelectPickerRow(_:))
            )
            button.tag = index
            button.bezelStyle = .recessed
            button.alignment = .left
            button.translatesAutoresizingMaskIntoConstraints = false
            stack.addArrangedSubview(button)
            button.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
        }
    }

    @objc private func onPickerSearchChanged(_ sender: NSSearchField) {
        let query = sender.stringValue.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if query.isEmpty {
            pickerFiltered = pickerCredentials
        } else {
            pickerFiltered = pickerCredentials.filter { item in
                item.title.lowercased().contains(query) ||
                    item.username.lowercased().contains(query) ||
                    item.serviceIdentifier.lowercased().contains(query)
            }
        }
        Task { @MainActor in
            self.renderPickerRows()
        }
    }

    @objc private func onSelectPickerRow(_ sender: NSButton) {
        let idx = sender.tag
        guard idx >= 0, idx < pickerFiltered.count else { return }
        let selected = pickerFiltered[idx]
        Task.detached { [weak self] in
            guard let self = self else { return }
            do {
                let fresh = try fetchPasswordCredential(recordIdentifier: selected.recordIdentifier)
                let password = fresh.password ?? selected.password ?? ""
                let credential = ASPasswordCredential(user: fresh.username, password: password)
                self.extensionContext.completeRequest(withSelectedCredential: credential, completionHandler: nil)
            } catch {
                if let fallbackPassword = selected.password {
                    let credential = ASPasswordCredential(user: selected.username, password: fallbackPassword)
                    self.extensionContext.completeRequest(withSelectedCredential: credential, completionHandler: nil)
                } else {
                    self.extensionContext.cancelRequest(withError: ASExtensionError(.failed))
                }
            }
        }
    }

    @objc private func onCancelPicker() {
        self.extensionContext.cancelRequest(withError: ASExtensionError(.userCanceled))
    }

    private func createTimer() -> DispatchWorkItem {
        // Create a timer for 600 second timeout
        let timeoutTimer = DispatchWorkItem { [weak self] in
            guard let self = self else { return }
            logger.log("[autofill-extension] The operation timed out after 600 seconds")
            self.extensionContext.cancelRequest(withError: VowkeyError.Internal("The operation timed out"))
        }

        // Schedule the timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 600, execute: timeoutTimer)

        return timeoutTimer
    }

    override func prepareInterface(forPasskeyRegistration registrationRequest: ASCredentialRequest) {
        logger.log("[autofill-extension] prepareInterface")
        let timeoutTimer = createTimer()


        if let request = registrationRequest as? ASPasskeyCredentialRequest {
            if let passkeyIdentity = registrationRequest.credentialIdentity as? ASPasskeyCredentialIdentity {
                logger.log("[autofill-extension] prepareInterface(passkey) called \(request)")

                class CallbackImpl: PreparePasskeyRegistrationCallback {
                    let ctx: ASCredentialProviderExtensionContext
                    let timeoutTimer: DispatchWorkItem
                    let logger: Logger
                    let onFinish: () -> Void

                    required init(_ ctx: ASCredentialProviderExtensionContext, _ logger: Logger,_ timeoutTimer: DispatchWorkItem, _ onFinish: @escaping () -> Void) {
                        self.ctx = ctx
                        self.logger = logger
                        self.timeoutTimer = timeoutTimer
                        self.onFinish = onFinish
                    }

                    func onComplete(credential: PasskeyRegistrationResponse) {
                        self.onFinish()
                        self.timeoutTimer.cancel()
                        ctx.completeRegistrationRequest(using: ASPasskeyRegistrationCredential(
                            relyingParty: credential.rpId,
                            clientDataHash: credential.clientDataHash,
                            credentialID: credential.credentialId,
                            attestationObject: credential.attestationObject
                        ))
                    }

                    func onError(error: VowkeyError) {
                        self.onFinish()
                        logger.error("[autofill-extension] OnError called, cancelling the request \(error)")
                        self.timeoutTimer.cancel()
                        // We only pass excluded credentials on macOS 15+, the same release that added this error code.
                        if case .ExcludedCredentialMatched = error, #available(macOSApplicationExtension 15.0, *) {
                            ctx.cancelRequest(withError: ASExtensionError(.matchedExcludedCredential))
                        } else {
                            ctx.cancelRequest(withError: error)
                        }
                    }
                }

                let userVerification = switch request.userVerificationPreference {
                case .preferred:
                    UserVerification.preferred
                case .required:
                    UserVerification.required
                default:
                    UserVerification.discouraged
                }

                // Convert excluded credentials to an array of credential IDs
                var excludedCredentialIds: [Data] = []
                if #available(macOSApplicationExtension 15.0, *) {
                    if let excludedCreds = request.excludedCredentials {
                        excludedCredentialIds = excludedCreds.map { $0.credentialID }
                    }
                }

                logger.log("[autofill-extension] prepareInterface(passkey) calling preparePasskeyRegistration")

                Task {
                    let clientWindow = await self.getWindowDetails()
                    let context = UUID().uuidString
                    let req = PasskeyRegistrationRequest(
                        rpId: passkeyIdentity.relyingPartyIdentifier,
                        clientDataHash: request.clientDataHash,
                        userVerification: userVerification,
                        clientWindow: clientWindow,
                        userName: passkeyIdentity.userName,
                        userHandle: passkeyIdentity.userHandle,
                        supportedAlgorithms: request.supportedAlgorithms.map{ Int32($0.rawValue) },
                        excludedCredentials: excludedCredentialIds,
                        context: context
                    )

                    let client = await getClient()
                    self.beginRequest(context)
                    client.preparePasskeyRegistration(request: req, callback: CallbackImpl(self.extensionContext, self.logger, timeoutTimer, { [weak self] in self?.finishRequest() }))
                }
                return
            }
        }

        logger.log("[autofill-extension] We didn't get a passkey")

        timeoutTimer.cancel()
        // If we didn't get a passkey, return an error
        self.extensionContext.cancelRequest(withError: VowkeyError.Internal("Invalid registration request"))
    }

    override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier], requestParameters: ASPasskeyCredentialRequestParameters) {
        logger.log("[autofill-extension] prepareCredentialList(passkey) for serviceIdentifiers: \(serviceIdentifiers.count)")

        class CallbackImpl: PreparePasskeyAssertionCallback {
            let ctx: ASCredentialProviderExtensionContext
            let timeoutTimer: DispatchWorkItem
            let logger: Logger
            let onFinish: () -> Void
            required init(_ ctx: ASCredentialProviderExtensionContext,_ logger: Logger, _ timeoutTimer: DispatchWorkItem, _ onFinish: @escaping () -> Void) {
                self.ctx = ctx
                self.logger = logger
                self.timeoutTimer = timeoutTimer
                self.onFinish = onFinish
            }

            func onComplete(credential: PasskeyAssertionResponse) {
                self.onFinish()
                self.timeoutTimer.cancel()
                ctx.completeAssertionRequest(using: ASPasskeyAssertionCredential(
                    userHandle: credential.userHandle,
                    relyingParty: credential.rpId,
                    signature: credential.signature,
                    clientDataHash: credential.clientDataHash,
                    authenticatorData: credential.authenticatorData,
                    credentialID: credential.credentialId
                ))
            }

            func onError(error: VowkeyError) {
                self.onFinish()
                logger.error("[autofill-extension] OnError called, cancelling the request \(error)")
                self.timeoutTimer.cancel()
                ctx.cancelRequest(withError: error)
            }
        }

        let userVerification = switch requestParameters.userVerificationPreference {
        case .preferred:
            UserVerification.preferred
        case .required:
            UserVerification.required
        default:
            UserVerification.discouraged
        }

        let timeoutTimer = createTimer()

        Task {
            let clientWindow = await self.getWindowDetails()
            let context = UUID().uuidString
            let req = PasskeyAssertionRequest(
                rpId: requestParameters.relyingPartyIdentifier,
                clientDataHash: requestParameters.clientDataHash,
                userVerification: userVerification,
                clientWindow: clientWindow,
                allowedCredentials: requestParameters.allowedCredentials,
                context: context
            )

            let client = await getClient()
            self.beginRequest(context)
            client.preparePasskeyAssertion(request: req, callback: CallbackImpl(self.extensionContext, self.logger, timeoutTimer, { [weak self] in self?.finishRequest() }))
        }
        return
    }
}
