import { mock } from "jest-mock-extended";

import { LogService } from "@vowkey/common/platform/abstractions/log.service";
import { IpcClient, ipcRequestDiscover } from "@vowkey/sdk-internal";

import { CliDesktopIpcTransport } from "./cli-desktop-ipc.transport";
import { CliIpcService, MINIMUM_BIOMETRIC_DESKTOP_VERSION } from "./cli-ipc.service";

jest.mock("@vowkey/sdk-internal", () => ({
  ...jest.requireActual("@vowkey/sdk-internal"),
  ipcRequestDiscover: jest.fn(),
}));

describe("CliIpcService", () => {
  const logService = mock<LogService>();
  const client = mock<IpcClient>();
  const transport = mock<CliDesktopIpcTransport>();

  let service: CliIpcService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CliIpcService(logService);
    Object.defineProperty(service, "_client", { configurable: true, value: client });
    Object.assign(service as object, {
      initialization: Promise.resolve(),
      transport,
    });
  });

  it("discovers the connected desktop version", async () => {
    jest.mocked(ipcRequestDiscover).mockResolvedValue({ version: "2026.9.0" });

    await expect(service.verifyDesktopConnection()).resolves.toBe("2026.9.0");
    expect(ipcRequestDiscover).toHaveBeenCalledWith(
      client,
      "DesktopRenderer",
      expect.any(AbortSignal),
    );

    await expect(service.verifyDesktopConnection()).resolves.toBe("2026.9.0");
    expect(ipcRequestDiscover).toHaveBeenCalledTimes(1);
  });

  it("disconnects and reports the minimum version when discovery fails", async () => {
    jest.mocked(ipcRequestDiscover).mockRejectedValue(new Error("request timed out"));

    await expect(service.verifyDesktopConnection()).rejects.toThrow(
      `Biometric unlock requires Vowkey Desktop ${MINIMUM_BIOMETRIC_DESKTOP_VERSION} or newer`,
    );
    expect(transport.disconnect).toHaveBeenCalled();
  });

  it("disconnects when the discovered desktop version is too old", async () => {
    jest.mocked(ipcRequestDiscover).mockResolvedValue({ version: "2026.8.0" });

    await expect(service.verifyDesktopConnection()).rejects.toThrow(
      `Biometric unlock requires Vowkey Desktop ${MINIMUM_BIOMETRIC_DESKTOP_VERSION} or newer`,
    );
    expect(transport.disconnect).toHaveBeenCalled();
  });
});
