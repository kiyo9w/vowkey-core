// swiftlint:disable:this file_name

import VowkeySdk
import Foundation

@testable import AuthenticatorShared

extension VowkeySdk.AuthenticatorAssertionResponse {
    static func fixture(
        clientDataJson: Data = Data(capacity: 37),
        authenticatorData: Data = Data(capacity: 37),
        signature: Data = Data(capacity: 64),
        userHandle: Data = Data(capacity: 64),
    ) -> VowkeySdk.AuthenticatorAssertionResponse {
        .init(
            clientDataJson: clientDataJson,
            authenticatorData: authenticatorData,
            signature: signature,
            userHandle: userHandle,
        )
    }
}

extension VowkeySdk.AuthenticatorAttestationResponse {
    static func fixture(
        clientDataJson: Data = Data(capacity: 37),
        authenticatorData: Data = Data(capacity: 37),
        publicKey: Data? = nil,
        publicKeyAlgorithm: Int64 = -7,
        attestationObject: Data = Data(capacity: 64),
        transports: [String]? = nil,
    ) -> VowkeySdk.AuthenticatorAttestationResponse {
        .init(
            clientDataJson: clientDataJson,
            authenticatorData: authenticatorData,
            publicKey: publicKey,
            publicKeyAlgorithm: publicKeyAlgorithm,
            attestationObject: attestationObject,
            transports: transports,
        )
    }
}

extension VowkeySdk.ClientExtensionResults {
    static func fixture(
        credProps: VowkeySdk.CredPropsResult? = nil,
    ) -> VowkeySdk.ClientExtensionResults {
        .init(credProps: credProps)
    }
}

extension VowkeySdk.GetAssertionResult {
    static func fixture(
        credentialId: Data = Data(capacity: 16),
        authenticatorData: Data = Data(capacity: 37),
        signature: Data = Data(capacity: 64),
        userHandle: Data = Data(capacity: 64),
        selectedCredential: SelectedCredential = .fixture(),
        extensions: GetAssertionExtensionsOutput = .init(prf: nil),
    ) -> VowkeySdk.GetAssertionResult {
        .init(
            credentialId: credentialId,
            authenticatorData: authenticatorData,
            signature: signature,
            userHandle: userHandle,
            selectedCredential: selectedCredential,
            extensions: extensions,
        )
    }
}

extension VowkeySdk.MakeCredentialResult {
    static func fixture(
        authenticatorData: Data = Data(capacity: 37),
        attestationObject: Data = Data(capacity: 37),
        credentialId: Data = Data(capacity: 16),
        extensions: MakeCredentialExtensionsOutput = .init(prf: nil),
    ) -> VowkeySdk.MakeCredentialResult {
        .init(
            authenticatorData: authenticatorData,
            attestationObject: attestationObject,
            credentialId: credentialId,
            extensions: extensions,
        )
    }
}

extension VowkeySdk.PublicKeyCredentialAuthenticatorAssertionResponse {
    static func fixture(
        id: String = "1",
        rawId: Data = Data(capacity: 16),
        type: String = "webauthn.get",
        authenticatorAttachment: String? = nil,
        clientExtensionResults: ClientExtensionResults = .fixture(),
        response: AuthenticatorAssertionResponse = .fixture(),
        selectedCredential: SelectedCredential = .fixture(),
    ) -> VowkeySdk.PublicKeyCredentialAuthenticatorAssertionResponse {
        .init(
            id: id,
            rawId: rawId,
            ty: type,
            authenticatorAttachment: authenticatorAttachment,
            clientExtensionResults: clientExtensionResults,
            response: response,
            selectedCredential: selectedCredential,
        )
    }
}

extension VowkeySdk.PublicKeyCredentialAuthenticatorAttestationResponse {
    static func fixture(
        id: String = "1",
        rawId: Data = Data(capacity: 16),
        type: String = "webauthn.create",
        authenticatorAttachment: String? = nil,
        clientExtensionResults: ClientExtensionResults = .fixture(),
        response: AuthenticatorAttestationResponse = .fixture(),
        selectedCredential: SelectedCredential = .fixture(),
    ) -> VowkeySdk.PublicKeyCredentialAuthenticatorAttestationResponse {
        .init(
            id: id,
            rawId: rawId,
            ty: type,
            authenticatorAttachment: authenticatorAttachment,
            clientExtensionResults: clientExtensionResults,
            response: response,
            selectedCredential: selectedCredential,
        )
    }
}

extension VowkeySdk.SelectedCredential {
    static func fixture(
        cipherView: CipherView = .fixture(),
        credential: Fido2CredentialView = .fixture(),
    ) -> VowkeySdk.SelectedCredential {
        .init(cipher: .fixture(), credential: .fixture())
    }
}

extension VowkeySdk.Fido2CredentialAutofillView {
    static let defaultRpId = "myApp.com"

    static func fixture(
        credentialId: Data = Data(capacity: 16),
        cipherId: String = "1",
        rpId: String = defaultRpId,
        userNameForUi: String? = nil,
        userHandle: Data = Data(capacity: 64),
        hasCounter: Bool = false,
    ) -> VowkeySdk.Fido2CredentialAutofillView {
        .init(
            credentialId: credentialId,
            cipherId: cipherId,
            rpId: rpId,
            userNameForUi: userNameForUi,
            userHandle: userHandle,
            hasCounter: hasCounter,
        )
    }
}

extension VowkeySdk.Fido2CredentialNewView {
    static let defaultRpId = "myApp.com"

    static func fixture(
        credentialId: String = "",
        keyType: String = "",
        keyAlgorithm: String = "",
        keyCurve: String = "",
        rpId: String = defaultRpId,
        userHandle: String? = nil,
        userName: String? = nil,
        counter: String = "0",
        rpName: String? = nil,
        userDisplayName: String? = nil,
        creationDate: DateTime = DateTime.distantPast,
    ) -> VowkeySdk.Fido2CredentialNewView {
        .init(
            credentialId: credentialId,
            keyType: keyType,
            keyAlgorithm: keyAlgorithm,
            keyCurve: keyCurve,
            rpId: rpId,
            userHandle: userHandle,
            userName: userName,
            counter: counter,
            rpName: rpName,
            userDisplayName: userDisplayName,
            creationDate: creationDate,
        )
    }
}
