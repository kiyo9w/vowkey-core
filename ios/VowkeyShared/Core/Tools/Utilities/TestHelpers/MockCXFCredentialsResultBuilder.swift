import VowkeySdk

@testable import VowkeyShared

class MockCXFCredentialsResultBuilder: CXFCredentialsResultBuilder {
    var buildResult: [CXFCredentialsResult] = []

    func build(from ciphers: [Cipher]) -> [CXFCredentialsResult] {
        buildResult
    }
}
