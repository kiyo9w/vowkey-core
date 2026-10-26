// swiftlint:disable:this file_name

import AuthenticationServices
import VowkeySdk

// MARK: - GetAssertionRequest

extension GetAssertionRequest {
    /// Initializes a `GetAssertionRequest` based on `fido2RequestParameters`
    /// - Parameter fido2RequestParameters: The Fido2 request parameters.
    init(fido2RequestParameters: PasskeyCredentialRequestParameters) {
        self = .init(
            rpId: fido2RequestParameters.relyingPartyIdentifier,
            clientDataHash: fido2RequestParameters.clientDataHash,
            allowList: fido2RequestParameters.allowedCredentials.map { credentialId in
                PublicKeyCredentialDescriptor(
                    ty: "public-key",
                    id: credentialId,
                    transports: nil,
                )
            },
            options: Options(
                rk: false,
                uv: VowkeySdk.Uv(preference: fido2RequestParameters.userVerificationPreference),
            ),
            extensions: nil,
        )
    }

    /// Initializes a `GetAssertionRequest` based on `passkeyRequest` and its `credentialIdentity`
    /// - Parameters:
    ///   - passkeyRequest: The `ASPasskeyCredentialRequest` of the flow.
    ///   - credentialIdentity: The `ASPasskeyCredentialIdentity` of the request.
    @available(iOSApplicationExtension 17.0, *)
    init(passkeyRequest: ASPasskeyCredentialRequest, credentialIdentity: ASPasskeyCredentialIdentity) {
        self = .init(
            rpId: credentialIdentity.relyingPartyIdentifier,
            clientDataHash: passkeyRequest.clientDataHash,
            allowList: [
                PublicKeyCredentialDescriptor(
                    ty: "public-key",
                    id: credentialIdentity.credentialID,
                    transports: nil,
                ),
            ],
            options: Options(
                rk: false,
                uv: VowkeySdk.Uv(preference: passkeyRequest.userVerificationPreference),
            ),
            extensions: nil,
        )
    }
}

// MARK: - ASPasskeyAssertionCredential

@available(iOS 17.0, *)
extension ASPasskeyAssertionCredential {
    /// Creates a passkey assertion credential from a Vowkey SDK assertion result.
    ///
    /// This convenience initializer creates an `ASPasskeyAssertionCredential` from the result
    /// of a FIDO2 assertion operation performed by the Vowkey SDK. It handles compatibility
    /// across iOS versions, including extension output support on iOS 18+.
    ///
    /// - Parameters:
    ///   - assertionResult: The result from the Vowkey SDK's `getAssertion` operation,
    ///                      containing the signature, authenticator data, and credential ID.
    ///   - rpId: The relying party identifier for the credential.
    ///   - clientDataHash: The hash of the client data JSON from the authentication request.
    ///
    convenience init(assertionResult: GetAssertionResult, rpId: String, clientDataHash: Data) {
        if #available(iOSApplicationExtension 18.0, *) {
            self.init(
                userHandle: assertionResult.userHandle,
                relyingParty: rpId,
                signature: assertionResult.signature,
                clientDataHash: clientDataHash,
                authenticatorData: assertionResult.authenticatorData,
                credentialID: assertionResult.credentialId,
                extensionOutput: nil, // TODO: PM-26177 once SDK is updated for full PRF support we can include this
            )
        } else {
            self.init(
                userHandle: assertionResult.userHandle,
                relyingParty: rpId,
                signature: assertionResult.signature,
                clientDataHash: clientDataHash,
                authenticatorData: assertionResult.authenticatorData,
                credentialID: assertionResult.credentialId,
            )
        }
    }
}

// MARK: - ASPasskeyCredentialIdentity

@available(iOS 17.0, *)
extension ASPasskeyCredentialIdentity {
    convenience init(deviceAuthKeyMetadata metadata: DeviceAuthKeyKeychainMetadata) {
        self.init(
            relyingPartyIdentifier: metadata.rpId,
            userName: metadata.userName,
            credentialID: metadata.credentialId,
            userHandle: metadata.userHandle,
            recordIdentifier: metadata.cipherId,
        )
    }
}

// MARK: - MakeCredentialRequest

extension VowkeySdk.MakeCredentialRequest: @retroactive CustomDebugStringConvertible {
    public var debugDescription: String {
        let rpName = rp.name ?? "nil"
        let excludeList = excludeList?.description ?? "nil"
        let extensions = if let extensions { String(describing: extensions) } else { "nil" }

        return [
            "ClientDataHash: \(clientDataHash.asHexString())",
            "RP -> Id: \(rp.id)",
            "RP -> Name: \(rpName)",
            "User -> Id: \(user.id.asHexString())",
            "User -> Name: \(user.name)",
            "User -> DisplayName: \(user.displayName)",
            "PubKeyCredParams: \(pubKeyCredParams.description)",
            "ExcludeList: \(excludeList)",
            "Options -> RK: \(options.rk)",
            "Options -> UV: \(String(describing: options.uv))",
            "Extensions: \(extensions)",
        ].joined(separator: "\n")
    }
}

// MARK: - MakeCredentialResult

extension VowkeySdk.MakeCredentialResult: @retroactive CustomDebugStringConvertible {
    public var debugDescription: String {
        [
            "AuthenticatorData: \(authenticatorData.asHexString())",
            "AttestationObject: \(attestationObject.asHexString())",
            "CredentialId: \(credentialId.asHexString())",
            "Extensions: \(extensions)",
        ].joined(separator: "\n")
    }
}

// MARK: - Uv

extension VowkeySdk.Uv {
    init(preference: ASAuthorizationPublicKeyCredentialUserVerificationPreference) {
        switch preference {
        case ASAuthorizationPublicKeyCredentialUserVerificationPreference.discouraged:
            self = VowkeySdk.Uv.discouraged
        case ASAuthorizationPublicKeyCredentialUserVerificationPreference.preferred:
            self = VowkeySdk.Uv.preferred
        case ASAuthorizationPublicKeyCredentialUserVerificationPreference.required:
            self = VowkeySdk.Uv.required
        default:
            self = VowkeySdk.Uv.required
        }
    }
}
