import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { DeviceCa } from "./device-ca";
import { trustDeviceCa } from "./trust";

describe("trustDeviceCa", () => {
  let file: string;
  beforeAll(async () => {
    const ca = await DeviceCa.ephemeral("Trust test CA");
    file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vowkey-trust-")), "proxy-ca.crt");
    fs.writeFileSync(file, ca.certificatePem);
  });

  it("adds a root to the macOS login keychain with the security tool", () => {
    const calls: [string, string[]][] = [];
    trustDeviceCa(file, false, "darwin", (c, a) => calls.push([c, a]));
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe("security");
    expect(calls[0][1].slice(0, 3)).toEqual(["add-trusted-cert", "-r", "trustRoot"]);
    expect(calls[0][1]).toContain(file);
    expect(calls[0][1].join(" ")).toContain("login.keychain-db");
  });

  it("removes that specific certificate on macOS", () => {
    const calls: [string, string[]][] = [];
    trustDeviceCa(file, true, "darwin", (c, a) => calls.push([c, a]));
    expect(calls[0][1][0]).toBe("remove-trusted-cert");
    expect(calls[1][1].slice(0, 2)).toEqual(["delete-certificate", "-Z"]);
    expect(calls[1][1][2]).toMatch(/^[0-9A-F]{40}$/);
  });

  it("uses the current user's Root store on Windows", () => {
    const calls: [string, string[]][] = [];
    trustDeviceCa(file, false, "win32", (c, a) => calls.push([c, a]));
    expect(calls[0]).toEqual(["certutil", ["-user", "-addstore", "Root", file]]);
  });

  it("changes nothing on a system whose trust the distribution owns", () => {
    const run = jest.fn();
    expect(() => trustDeviceCa(file, false, "linux", run)).toThrow("distribution");
    expect(run).not.toHaveBeenCalled();
  });
});
