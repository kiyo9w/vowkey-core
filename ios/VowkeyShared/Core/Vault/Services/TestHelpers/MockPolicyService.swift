import VowkeyKit
import VowkeySdk
@testable import VowkeyShared

class MockPolicyService: PolicyService {
    var applyPasswordGenerationOptionsCalled = false
    var applyPasswordGenerationOptionsError: Error?
    var applyPasswordGenerationOptionsResult = false
    var applyPasswordGenerationOptionsTransform = { (_: inout PasswordGenerationOptions) in }

    var getMasterPasswordPolicyOptionsResult: Result<MasterPasswordPolicyOptions?, Error> = .success(
        MasterPasswordPolicyOptions(
            minComplexity: 2,
            minLength: 8,
            requireUpper: true,
            requireLower: false,
            requireNumbers: true,
            requireSpecial: false,
            enforceOnLogin: true,
        ),
    )

    var getSendPolicyOptionsResult = SendPolicyOptions()

    var fetchTimeoutPolicyValuesResult: Result<SessionTimeoutPolicy?, Error> = .success(nil)

    var getEarliestOrganizationApplyingPolicyResult: [VowkeyShared.PolicyType: String?] = [:] // swiftlint:disable:this identifier_name line_length

    // swiftlint:disable:next identifier_name
    var getOrganizationUserNotificationBannerDataResult: OrganizationUserNotificationBannerData?

    var organizationsApplyingPolicyToUserResult: [VowkeyShared.PolicyType: [String]] = [:]

    var policyAppliesToUserResult = [VowkeyShared.PolicyType: Bool]()
    var policyAppliesToUserPoliciesType = [VowkeyShared.PolicyType]()
    var policyAppliesToUserPolicies = [VowkeyShared.Policy]()
    var getRestrictedItemCipherTypesResult: [VowkeyShared.CipherType] = []

    var replacePoliciesPolicies = [PolicyResponseModel]()
    var replacePoliciesUserId: String?
    var replacePoliciesResult: Result<Void, Error> = .success(())

    func applyPasswordGenerationPolicy(options: inout PasswordGenerationOptions) async throws -> Bool {
        applyPasswordGenerationOptionsCalled = true
        if let applyPasswordGenerationOptionsError {
            throw applyPasswordGenerationOptionsError
        }
        applyPasswordGenerationOptionsTransform(&options)
        return applyPasswordGenerationOptionsResult
    }

    func getOrganizationIdsForRestricItemTypesPolicy() async -> [String] {
        policyAppliesToUserPolicies.map(\.organizationId)
    }

    func getOrganizationUserNotificationBannerData() async -> OrganizationUserNotificationBannerData? {
        getOrganizationUserNotificationBannerDataResult
    }

    func getRestrictedItemCipherTypes() async -> [VowkeyShared.CipherType] {
        getRestrictedItemCipherTypesResult
    }

    func getMasterPasswordPolicyOptions() async throws -> MasterPasswordPolicyOptions? {
        try getMasterPasswordPolicyOptionsResult.get()
    }

    func getSendPolicyOptions() async -> SendPolicyOptions {
        getSendPolicyOptionsResult
    }

    func fetchTimeoutPolicyValues() async throws -> SessionTimeoutPolicy? {
        try fetchTimeoutPolicyValuesResult.get()
    }

    func getEarliestOrganizationApplyingPolicy(_ policyType: VowkeyShared.PolicyType) async -> String? {
        getEarliestOrganizationApplyingPolicyResult[policyType] ?? nil
    }

    func organizationsApplyingPolicyToUser(_ policyType: VowkeyShared.PolicyType) async -> [String] {
        organizationsApplyingPolicyToUserResult[policyType] ?? []
    }

    func policyAppliesToUser(_ policyType: VowkeyShared.PolicyType) async -> Bool {
        policyAppliesToUserPoliciesType.append(policyType)
        return policyAppliesToUserResult[policyType] ?? false
    }

    func replacePolicies(_ policies: [PolicyResponseModel], userId: String) async throws {
        replacePoliciesPolicies = policies
        replacePoliciesUserId = userId
        try replacePoliciesResult.get()
    }
}
