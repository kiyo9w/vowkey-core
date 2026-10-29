import { runInNewContext } from "node:vm";

import { canonicalJson } from "@vowkey/common/vault/local/canonical-json";

it("canonicalizes JSON from another realm using the same wire representation", () => {
  const body = runInNewContext('JSON.parse(\'{"z":[{"b":2,"a":1}],"a":"é"}\')');
  expect(canonicalJson(body)).toBe('{"a":"é","z":[{"a":1,"b":2}]}');
  expect(() => canonicalJson({ timestamp: new Date() })).toThrow("JSON values only");
  expect(() => canonicalJson({ value: Number.NaN })).toThrow("finite numbers");
});
