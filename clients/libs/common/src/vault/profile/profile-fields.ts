import { IdentityFields, ProfileFields } from "@vowkey/sdk-internal";

import { FieldType } from "../enums";
import { CipherView } from "../models/view/cipher.view";
import { FieldView } from "../models/view/field.view";
import { IdentityView } from "../models/view/identity.view";
import { agentRuleOf, readEnvelope, splitKey, VK_META_FIELD } from "./vk-meta";

const IDENTITY_FIELD_ATTRIBUTES: ReadonlyArray<readonly [keyof IdentityFields, string]> = [
  ["title", "name.prefix"],
  ["first_name", "name.given"],
  ["middle_name", "name.middle"],
  ["last_name", "name.family"],
  ["address1", "address.street"],
  ["address2", "address.building"],
  ["address3", "address.line3"],
  ["city", "address.city"],
  ["state", "address.prefecture"],
  ["postal_code", "address.postal"],
  ["country", "address.country"],
  ["company", "work.employer.name"],
  ["email", "contact.email"],
  ["phone", "contact.phone"],
  ["ssn", "id.ssn"],
  ["passport_number", "id.passport.number"],
  ["license_number", "id.driver_license.number"],
];

/**
 * A profile is a person's details kept in one Identity item. The Identity item's own fields and
 * its text custom fields are what the details engine reads and writes.
 */
export function profileFieldsOf(cipher: CipherView): ProfileFields {
  const identity = cipher.identity;
  const custom = new Map<string, string>();
  for (const field of cipher.fields ?? []) {
    if (
      (field.type === FieldType.Text || field.type === FieldType.Hidden) &&
      field.name &&
      field.name !== VK_META_FIELD &&
      field.value
    ) {
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

/**
 * Returns a profile's fields with any detail marked `"never"` (`Don't fill`) excluded so web,
 * document, PDF, and image fillers honor the same per-detail permission rule as agent requests.
 */
export function fillableProfileFieldsOf(cipher: CipherView): ProfileFields {
  const base = profileFieldsOf(cipher);
  const envelope = Array.isArray(cipher.fields) ? readEnvelope(cipher) : null;
  if (envelope == null) {
    return base;
  }
  const blockedAttributes = new Set<string>();
  const blockedLabels = new Set<string>();
  for (const detail of envelope.details) {
    if (agentRuleOf(detail) !== "never") {
      continue;
    }
    if (detail.attribute) {
      const normalized = detail.attribute.replace(/^vk\./, "");
      blockedAttributes.add(detail.attribute);
      blockedAttributes.add(normalized);
      blockedAttributes.add(splitKey(normalized).attribute);
    }
    if (detail.label) {
      blockedLabels.add(detail.label);
    }
    blockedLabels.add(`custom.${detail.id}`);
  }
  if (blockedAttributes.size === 0 && blockedLabels.size === 0) {
    return base;
  }
  const identity: IdentityFields = { ...base.identity };
  for (const [wire, attr] of IDENTITY_FIELD_ATTRIBUTES) {
    if (blockedAttributes.has(attr)) {
      identity[wire] = "";
    }
  }
  if (blockedAttributes.has("name.full")) {
    identity.first_name = "";
    identity.middle_name = "";
    identity.last_name = "";
  }
  if (blockedAttributes.has("address.full")) {
    identity.address1 = "";
    identity.address2 = "";
    identity.address3 = "";
    identity.city = "";
    identity.state = "";
    identity.postal_code = "";
    identity.country = "";
  }
  const custom = new Map<string, string>();
  for (const [name, value] of base.custom) {
    const stripped = name.replace(/^vk\./, "");
    const rootAttr = splitKey(stripped).attribute;
    if (
      blockedLabels.has(name) ||
      blockedLabels.has(stripped) ||
      blockedAttributes.has(name) ||
      blockedAttributes.has(stripped) ||
      blockedAttributes.has(rootAttr)
    ) {
      continue;
    }
    custom.set(name, value);
  }
  return { identity, custom };
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
    const existing = cipher.fields.find(
      (f) => (f.type === FieldType.Text || f.type === FieldType.Hidden) && f.name === name,
    );
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
