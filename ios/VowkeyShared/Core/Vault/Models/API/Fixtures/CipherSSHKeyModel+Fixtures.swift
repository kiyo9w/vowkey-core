import Foundation

@testable import VowkeyShared

extension CipherSSHKeyModel {
    static func fixture(
        keyFingerprint: String = "keyFingerprint",
        privateKey: String = "privateKey",
        publicKey: String = "publicKey",
    ) -> CipherSSHKeyModel {
        self.init(
            keyFingerprint: keyFingerprint,
            privateKey: privateKey,
            publicKey: publicKey,
        )
    }
}
