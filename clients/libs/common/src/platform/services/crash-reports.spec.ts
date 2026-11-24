import type { ErrorEvent } from "@sentry/core";

import { reduceCrashReport } from "./crash-reports";
describe("crash reports", () => {
  const event: ErrorEvent = {
    type: undefined,
    message: "couldn't open the vault at https://secret.example/vault",
    exception: {
      values: [
        {
          type: "Error",
          value: "couldn't open the vault at https://secret.example/vault",
          stacktrace: { frames: [{ filename: "https://secret.example/vault.js", function: "openVault" }, { filename: "vault.js" }] },
        },
      ],
    },
    release: "2026.11.0",
    contexts: { os: { name: "macOS" }, browser: { name: "Chrome" } },
    request: { url: "https://secret.example/vault?token=1" },
    breadcrumbs: [{ data: { password: "hunter2" } }],
    extra: { field: "passport number" },
    user: { id: "account" },
    tags: { page: "vault" },
  };


  it("retains diagnostic structure while excluding private event fields", () => {
    const report = reduceCrashReport(event);
    const encoded = JSON.stringify(report);
    for (const value of ["secret.example", "hunter2", "passport number", "account"]) {
      expect(encoded).not.toContain(value);
    }
    expect(report?.release).toBe("2026.11.0");
    expect(report?.contexts).toEqual({ os: { name: "macOS" } });
    expect(report?.exception?.values?.[0]?.stacktrace?.frames).toEqual([{ function: "openVault" }]);
  });

  it("keeps the error class without sending dynamic message values", () => {
    const report = reduceCrashReport({
      ...event,
      message: "Private value: CONFIDENTIAL_FIELD_VALUE",
      exception: { values: [{ type: "TypeError", value: "Private value: CONFIDENTIAL_FIELD_VALUE" }] },
    });
    expect(JSON.stringify(report)).not.toContain("CONFIDENTIAL_FIELD_VALUE");
    expect(report?.exception?.values?.[0]?.type).toBe("TypeError");
  });
});
