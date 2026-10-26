import WatchConnectivity

@testable import VowkeyShared

class MockWatchService: WatchService {
    var isSupportedValue: Bool = false

    func isSupported() -> Bool {
        isSupportedValue
    }
}
