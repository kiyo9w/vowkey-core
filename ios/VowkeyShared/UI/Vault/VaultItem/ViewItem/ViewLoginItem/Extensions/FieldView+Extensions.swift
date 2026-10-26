import VowkeySdk // swiftlint:disable:this file_name

// MARK: - FieldView+Update

extension VowkeySdk.FieldView {
    /// initializes a new FieldView with updated properties
    ///
    /// - Parameter customFieldState: The `CustomFieldState` used to create or update the field view.
    ///
    init(customFieldState: CustomFieldState) {
        self.init(
            name: customFieldState.name,
            value: customFieldState.value,
            type: VowkeySdk.FieldType(fieldType: customFieldState.type),
            linkedId: customFieldState.linkedIdType?.rawValue,
        )
    }
}
