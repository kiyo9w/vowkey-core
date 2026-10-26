@testable import VowkeyShared

class MockMigrationService: MigrationService {
    var didPerformMigrations: Bool?

    func performMigrations() async {
        didPerformMigrations = true
    }
}
