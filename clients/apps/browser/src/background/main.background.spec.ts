import MainBackground from "./main.background";

describe("MainBackground overlay initialization", () => {
  it("shares one pending owner between startup and login", async () => {
    const main = Object.create(MainBackground.prototype);
    const pending = Promise.resolve();
    const initialize = jest.fn(() => pending);
    main.initializeOverlayAndTabsBackground = initialize;

    const startup = main.initOverlayAndTabsBackground();
    const login = main.initOverlayAndTabsBackground();
    expect(login).toBe(startup);
    expect(initialize).toHaveBeenCalledTimes(1);

    await Promise.all([startup, login]);
  });

  it("allows login to try again after initialization rejects", async () => {
    const main = Object.create(MainBackground.prototype);
    const failure = new Error("initialization unavailable");
    main.initializeOverlayAndTabsBackground = jest.fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(undefined);

    await expect(main.initOverlayAndTabsBackground()).rejects.toBe(failure);
    await expect(main.initOverlayAndTabsBackground()).resolves.toBeUndefined();
    expect(main.initializeOverlayAndTabsBackground).toHaveBeenCalledTimes(2);
  });
});
