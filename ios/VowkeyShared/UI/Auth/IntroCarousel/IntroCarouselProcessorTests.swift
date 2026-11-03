import PDFKit
import VowkeyKitMocks
import VowkeyResources
import XCTest

@testable import VowkeyShared

class IntroCarouselProcessorTests: VowkeyTestCase {
    // MARK: Properties

    var configService: MockConfigService!
    var coordinator: MockCoordinator<AuthRoute, AuthEvent>!
    var subject: IntroCarouselProcessor!

    // MARK: Setup & Teardown

    override func setUp() {
        super.setUp()

        configService = MockConfigService()
        coordinator = MockCoordinator()

        subject = IntroCarouselProcessor(
            coordinator: coordinator.asAnyCoordinator(),
            services: ServiceContainer.withMocks(
                configService: configService,
            ),
            state: IntroCarouselState(),
        )
    }

    override func tearDown() {
        super.tearDown()

        configService = nil
        coordinator = nil
        subject = nil
    }

    // MARK: Tests

    /// `perform(_:)` with `.createAccount` navigates to the start registration view.
    @MainActor
    func test_perform_createAccount() async {
        await subject.perform(.createAccount)
        XCTAssertEqual(coordinator.routes.last, .startRegistration)
    }

    /// `receive(_:)` with `.currentPageIndexChanged` updates the current page index.
    @MainActor
    func test_receive_currentPageIndexChanged() {
        subject.receive(.currentPageIndexChanged(1))
        XCTAssertEqual(subject.state.currentPageIndex, 1)

        subject.receive(.currentPageIndexChanged(2))
        XCTAssertEqual(subject.state.currentPageIndex, 2)

        subject.receive(.currentPageIndexChanged(0))
        XCTAssertEqual(subject.state.currentPageIndex, 0)
    }

    /// `receive(_:)` with `.continueWithoutAccount` navigates directly to the local device vault.
    @MainActor
    func test_receive_continueWithoutAccount() {
        subject.receive(.continueWithoutAccount)
        XCTAssertEqual(coordinator.routes.last, .localVault)
    }

    /// `receive(_:)` with `.logIn` navigates to the landing view.
    @MainActor
    func test_receive_logIn() {
        subject.receive(.logIn)
        XCTAssertEqual(coordinator.routes.last, .landing)
    }

    /// `IntroCarouselState` populates localized pages without posture jargon, and `NativeProfile` humanizes detail keys.
    @MainActor
    func test_localizedCopyAndProfileDetailLabels() {
        XCTAssertEqual(subject.state.pages.count, 4)
        XCTAssertEqual(subject.state.pages[0].title, Localizations.vowkeyIntroDocTitle)
        XCTAssertEqual(subject.state.pages[2].message, Localizations.vowkeyIntroAgentMessage)
        XCTAssertEqual(subject.state.pages[3].cardBadge, Localizations.vowkeyIntroSyncCardBadge)
        XCTAssertFalse(subject.state.pages.contains { $0.cardBadge.localizedCaseInsensitiveContains("zero-knowledge") })

        XCTAssertEqual(NativeProfile.displayLabel(for: "id.passport.number"), Localizations.vowkeyAttrPassportNumber)
        XCTAssertEqual(NativeProfile.displayLabel(for: "id.residence_card.number"), Localizations.vowkeyAttrResidenceCard)
        XCTAssertEqual(NativeProfile.displayLabel(for: "custom.permit_code"), "Custom Permit Code")
    }

    /// `NativeDecision` matches form labels semantically via Rust `captureFillForm` and fills AcroForm PDF widgets offline.
    @MainActor
    func test_nativeDecision_fillsAcroFormPdfAndHeuristicFieldOffline() throws {
        let profile = try NativeProfile.captured(
            [
                "details": [
                    "name.full": "Yuki Tanaka",
                    "id.passport.number": "TR9842105",
                ],
                "sources": [:],
            ],
            fileName: "passport.pdf",
            mediaType: "application/pdf",
            attachmentId: "att-1",
        )

        let matchedPassport = NativeDecision.fillSingleFieldLocally(
            label: "旅券番号 / Passport No.",
            section: "Applicant",
            profile: profile,
        )
        XCTAssertEqual(matchedPassport, "TR9842105")

        let pdf = PDFDocument()
        let page = PDFPage()
        let nameWidget = PDFAnnotation(
            bounds: CGRect(x: 72, y: 600, width: 200, height: 24),
            forType: .widget,
            withProperties: nil,
        )
        nameWidget.widgetFieldType = .text
        nameWidget.fieldName = "applicant_full_name"
        page.addAnnotation(nameWidget)
        pdf.insert(page, at: 0)
        let rawPdf = try XCTUnwrap(pdf.dataRepresentation())

        let (filledData, filledCount) = try NativeDecision.fillPDF(data: rawPdf, profile: profile)
        XCTAssertEqual(filledCount, 1)
        let reloaded = try XCTUnwrap(PDFDocument(data: filledData))
        let reloadedWidget = try XCTUnwrap(reloaded.page(at: 0)?.annotations.first)
        XCTAssertEqual(reloadedWidget.widgetStringValue, "Yuki Tanaka")
    }
}
