package com.vowkey.app.ui.vault.model

import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.Text
import com.vowkey.ui.util.asText

/**
 * Represents the types for linked fields.
 *
 * @param id The ID for the linked field.
 * @param label A human-readable label for the linked field.
 */
enum class VaultLinkedFieldType(
    val id: UInt,
    val label: Text,
) {
    USERNAME(id = 100.toUInt(), label = VowkeyString.username.asText()),
    PASSWORD(id = 101.toUInt(), label = VowkeyString.password.asText()),

    CARDHOLDER_NAME(id = 300.toUInt(), label = VowkeyString.cardholder_name.asText()),
    EXPIRATION_MONTH(id = 301.toUInt(), label = VowkeyString.expiration_month.asText()),
    EXPIRATION_YEAR(id = 302.toUInt(), label = VowkeyString.expiration_year.asText()),
    SECURITY_CODE(id = 303.toUInt(), label = VowkeyString.security_code.asText()),
    BRAND(id = 304.toUInt(), label = VowkeyString.brand.asText()),
    NUMBER(id = 305.toUInt(), label = VowkeyString.number.asText()),

    TITLE(id = 400.toUInt(), label = VowkeyString.title.asText()),
    MIDDLE_NAME(id = 401.toUInt(), label = VowkeyString.middle_name.asText()),
    ADDRESS_1(id = 402.toUInt(), label = VowkeyString.address1.asText()),
    ADDRESS_2(id = 403.toUInt(), label = VowkeyString.address2.asText()),
    ADDRESS_3(id = 404.toUInt(), label = VowkeyString.address3.asText()),
    CITY(id = 405.toUInt(), label = VowkeyString.city_town.asText()),
    STATE(id = 406.toUInt(), label = VowkeyString.state_province.asText()),
    POSTAL_CODE(id = 407.toUInt(), label = VowkeyString.zip_postal_code.asText()),
    COUNTRY(id = 408.toUInt(), label = VowkeyString.country.asText()),
    COMPANY(id = 409.toUInt(), label = VowkeyString.company.asText()),
    EMAIL(id = 410.toUInt(), label = VowkeyString.email.asText()),
    PHONE(id = 411.toUInt(), label = VowkeyString.phone.asText()),
    SSN(id = 412.toUInt(), label = VowkeyString.ssn.asText()),
    IDENTITY_USERNAME(id = 413.toUInt(), label = VowkeyString.username.asText()),
    PASSPORT_NUMBER(id = 414.toUInt(), label = VowkeyString.passport_number.asText()),
    LICENSE_NUMBER(id = 415.toUInt(), label = VowkeyString.license_number.asText()),
    FIRST_NAME(id = 416.toUInt(), label = VowkeyString.first_name.asText()),
    LAST_NAME(id = 417.toUInt(), label = VowkeyString.last_name.asText()),
    FULL_NAME(id = 418.toUInt(), label = VowkeyString.full_name.asText()),
    ;

    @Suppress("UndocumentedPublicClass")
    companion object {
        /**
         * Helper function to get the LinkedCustomFieldType from the id
         */
        fun fromId(id: UInt): VaultLinkedFieldType =
            VaultLinkedFieldType.entries.first { it.id == id }
    }
}
