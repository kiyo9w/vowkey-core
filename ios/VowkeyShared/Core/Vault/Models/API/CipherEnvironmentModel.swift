import VowkeySdk

struct CipherEnvironmentModel: Codable, Equatable {
    var members: String?

    init(environment: VowkeySdk.Environment) { members = environment.members }
}

extension VowkeySdk.Environment {
    init(_ model: CipherEnvironmentModel) { self.init(members: model.members) }
}
