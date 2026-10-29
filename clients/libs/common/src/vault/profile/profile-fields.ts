import { IdentityFields, ProfileFields } from "@vowkey/sdk-internal";

import { FieldType } from "../enums";
import { CipherView } from "../models/view/cipher.view";
import { FieldView } from "../models/view/field.view";
import { IdentityView } from "../models/view/identity.view";
import { VK_META_FIELD } from "./vk-meta";

/**
 * A profile is a person's details kept in one Identity item. The Identity item's own fields and
 * its text custom fields are what the details engine reads and writes.
 */
export function profileFieldsOf(cipher: CipherView): ProfileFields {
  const identity = cipher.identity;
  const custom = new Map<string, string>();
  for (const field of cipher.fields ?? []) {
    if (field.type === FieldType.Text && field.name && field.name !== VK_META_FIELD && field.value) {
      custom.set(field.name, field.value);
    }
  }
  return {
    identity: {
      title: identity?.title ?? "",
      first_name: identity?.firstName ?? "",
      middle_name: identity?.middleName ?? "",
      last_name: identity?.lastName ?? "",
      address1: identity?.address1 ?? "",
      address2: identity?.address2 ?? "",
      address3: identity?.address3 ?? "",
      city: identity?.city ?? "",
      state: identity?.state ?? "",
      postal_code: identity?.postalCode ?? "",
      country: identity?.country ?? "",
      company: identity?.company ?? "",
      email: identity?.email ?? "",
      phone: identity?.phone ?? "",
      ssn: identity?.ssn ?? "",
      passport_number: identity?.passportNumber ?? "",
      license_number: identity?.licenseNumber ?? "",
    },
    custom,
  };
}

/** Writes a profile back into the Identity item: its own fields, and a custom field per detail. */
export function applyProfileFields(cipher: CipherView, profile: ProfileFields): void {
  const identity = (cipher.identity ??= new IdentityView());
  const own: IdentityFields = profile.identity;
  identity.title = own.title || undefined;
  identity.firstName = own.first_name || undefined;
  identity.middleName = own.middle_name || undefined;
  identity.lastName = own.last_name || undefined;
  identity.address1 = own.address1 || undefined;
  identity.address2 = own.address2 || undefined;
  identity.address3 = own.address3 || undefined;
  identity.city = own.city || undefined;
  identity.state = own.state || undefined;
  identity.postalCode = own.postal_code || undefined;
  identity.country = own.country || undefined;
  identity.company = own.company || undefined;
  identity.email = own.email || undefined;
  identity.phone = own.phone || undefined;
  identity.ssn = own.ssn || undefined;
  identity.passportNumber = own.passport_number || undefined;
  identity.licenseNumber = own.license_number || undefined;

  cipher.fields ??= [];
  for (const [name, value] of profile.custom) {
    if (name === VK_META_FIELD) {
      continue;
    }
    const existing = cipher.fields.find((f) => f.type === FieldType.Text && f.name === name);
    if (existing) {
      existing.value = value;
    } else {
      const field = new FieldView();
      field.name = name;
      field.value = value;
      field.type = FieldType.Text;
      cipher.fields.push(field);
    }
  }
}
