import * as http from "http";
import * as https from "https";
import * as net from "net";
import * as tls from "tls";

import { DeviceCa } from "./device-ca";
import { KeyProxy, MAX_SCANNED_BODY_BYTES, ProxyEvent, ProxyKey } from "./proxy";

const CREDENTIAL = "proxy-credential-0123456789";
const PLACEHOLDER = "vk_placeholder_abc123";

interface Seen {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

async function startOrigin(
  ca: DeviceCa,
  host: string,
  respond?: (req: http.IncomingMessage, res: http.ServerResponse) => void,
) {
  const seen: Seen[] = [];
  const server = https.createServer(
    { SNICallback: (_n, cb) => void ca.contextFor(host).then((c) => cb(null, c)) },
    (req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        seen.push({
          method: req.method!,
          url: req.url!,
          headers: req.headers,
          body: Buffer.concat(chunks),
        });
        if (respond != null) {
          respond(req, res);
        } else {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("ok");
        }
      });
    },
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    seen,
    port: (server.address() as net.AddressInfo).port,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

function connectThrough(
  proxyPort: number,
  authority: string,
  credential: string | null = CREDENTIAL,
) {
  return new Promise<{ status: number; socket: net.Socket }>((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port: proxyPort,
      method: "CONNECT",
      path: authority,
      headers:
        credential == null
          ? {}
          : {
              "Proxy-Authorization":
                "Basic " + Buffer.from(`vowkey:${credential}`).toString("base64"),
            },
    });
    req.once("connect", (res, socket) => resolve({ status: res.statusCode!, socket }));
    req.once("error", reject);
    req.end();
  });
}

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function tlsRequest(
  socket: net.Socket,
  options: {
    servername: string;
    ca: string;
    path?: string;
    method?: string;
    headers?: http.OutgoingHttpHeaders;
    body?: Buffer | string;
    host?: string;
    skipNameCheck?: boolean;
  },
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: options.host ?? options.servername,
        port: 443,
        defaultPort: 443,
        method: options.method ?? "GET",
        path: options.path ?? "/",
        headers: options.headers,
        createConnection: () =>
          tls.connect({
            socket,
            servername: options.servername,
            ca: options.ca,
            checkServerIdentity: options.skipNameCheck ? () => undefined : tls.checkServerIdentity,
          }),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode!,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(options.body);
  });
}

describe("KeyProxy", () => {
  let deviceCa: DeviceCa;
  let originCa: DeviceCa;

  beforeAll(async () => {
    deviceCa = await DeviceCa.ephemeral("Vowkey test device CA");
    originCa = await DeviceCa.ephemeral("Origin CA");
  });

  const key = (overrides: Partial<ProxyKey> = {}): ProxyKey => ({
    itemId: "key-1",
    name: "OpenAI",
    value: "sk-live-0123456789",
    sendStyle: "bearer",
    allowedHosts: ["api.test"],
    ...overrides,
  });

  async function setup(
    options: {
      keys?: ProxyKey[];
      chooseKey?: (itemIds: string[]) => Promise<string | null>;
      upstreamTrusted?: boolean;
      respond?: (req: http.IncomingMessage, res: http.ServerResponse) => void;
    } = {},
  ) {
    const origin = await startOrigin(originCa, "api.test", options.respond);
    const events: ProxyEvent[] = [];
    const proxy = new KeyProxy({
      port: 0,
      credential: CREDENTIAL,
      ca: deviceCa,
      keys: () => options.keys ?? [key()],
      placeholders: () => ({ "key-1": PLACEHOLDER, "key-2": "vk_placeholder_two" }),
      chooseKey: options.chooseKey ? async (_t, ids) => options.chooseKey!(ids) : undefined,
      onEvent: (e) => events.push(e),
      upstreamCa: options.upstreamTrusted === false ? undefined : originCa.certificatePem,
      lookup: async () => "127.0.0.1",
      mapPort: (_host, port) => (port === 443 || port === 8443 ? origin.port : port),
    });
    const port = await proxy.start();
    return {
      origin,
      proxy,
      port,
      events,
      stop: async () => {
        await proxy.stop();
        await origin.close();
      },
    };
  }

  it("attaches a bearer key to a request for its host, replacing one the client sent", async () => {
    const s = await setup();
    const { status, socket } = await connectThrough(s.port, "api.test:443");
    expect(status).toBe(200);
    const reply = await tlsRequest(socket, {
      servername: "api.test",
      ca: deviceCa.certificatePem,
      path: "/v1/models",
      headers: { Authorization: "Bearer the-client-sent-this" },
    });
    expect(reply).toMatchObject({ status: 200, body: "ok" });
    expect(s.origin.seen).toHaveLength(1);
    expect(s.origin.seen[0].headers.authorization).toBe("Bearer sk-live-0123456789");
    expect(s.events.at(-1)).toMatchObject({
      outcome: "forwarded",
      itemId: "key-1",
      host: "api.test",
      status: 200,
    });
    await s.stop();
  });

  it("attaches a named header and a Basic login with the other send styles", async () => {
    for (const [override, check] of [
      [
        { sendStyle: "header", headerName: "X-Api-Key" },
        (h: http.IncomingHttpHeaders) => h["x-api-key"] === "sk-live-0123456789",
      ],
      [
        { sendStyle: "basic", basicUsername: "me" },
        (h: http.IncomingHttpHeaders) =>
          h.authorization === "Basic " + Buffer.from("me:sk-live-0123456789").toString("base64"),
      ],
    ] as const) {
      const s = await setup({ keys: [key(override)] });
      const { socket } = await connectThrough(s.port, "api.test:443");
      await tlsRequest(socket, { servername: "api.test", ca: deviceCa.certificatePem });
      expect(check(s.origin.seen[0].headers)).toBe(true);
      await s.stop();
    }
  });

  it("never puts the key on a host no key lists: that CONNECT is a blind tunnel", async () => {
    const s = await setup();
    const other = await startOrigin(originCa, "other.test");
    const { status, socket } = await connectThrough(s.port, `other.test:${other.port}`);
    expect(status).toBe(200);
    // The client talks to the origin directly and verifies the origin's own certificate.
    const reply = await tlsRequest(socket, {
      servername: "other.test",
      ca: originCa.certificatePem,
      headers: { "X-Probe": PLACEHOLDER },
    });
    expect(reply.status).toBe(200);
    expect(other.seen[0].headers.authorization).toBeUndefined();
    // The placeholder is not substituted inside a tunnel the proxy cannot read.
    expect(other.seen[0].headers["x-probe"]).toBe(PLACEHOLDER);
    expect(s.events.at(-1)).toMatchObject({ outcome: "tunnelled", itemId: null });
    await other.close();
    await s.stop();
  });

  it("answers 407 to a client without the proxy credential", async () => {
    const s = await setup();
    const withoutCredential = await connectThrough(s.port, "api.test:443", null);
    expect(withoutCredential.status).toBe(407);
    const wrong = await connectThrough(s.port, "api.test:443", "not-the-credential");
    expect(wrong.status).toBe(407);
    expect(s.origin.seen).toHaveLength(0);
    await s.stop();
  });

  it("refuses a request whose Host is not the host that was CONNECTed", async () => {
    const s = await setup();
    const { socket } = await connectThrough(s.port, "api.test:443");
    const reply = await tlsRequest(socket, {
      servername: "api.test",
      ca: deviceCa.certificatePem,
      host: "other.test",
      headers: { Host: "other.test" },
    });
    expect(reply.status).toBe(403);
    expect(JSON.parse(reply.body)).toEqual({ code: "host-mismatch" });
    expect(s.origin.seen).toHaveLength(0);
    await s.stop();
  });

  it("refuses a client whose SNI is not the host that was CONNECTed", async () => {
    const s = await setup();
    const { socket } = await connectThrough(s.port, "api.test:443");
    const reply = await tlsRequest(socket, {
      servername: "other.test",
      ca: deviceCa.certificatePem,
      host: "api.test",
      headers: { Host: "api.test" },
      skipNameCheck: true,
    });
    expect(reply.status).toBe(403);
    expect(s.origin.seen).toHaveLength(0);
    await s.stop();
  });

  it("asks which key when two match, and attaches neither until one is chosen", async () => {
    const keys = [key(), key({ itemId: "key-2", name: "Other", value: "sk-second-9876543210" })];
    const refused = await setup({ keys });
    const first = await connectThrough(refused.port, "api.test:443");
    expect(first.status).toBe(409);
    expect(refused.origin.seen).toHaveLength(0);
    expect(refused.events.at(-1)).toMatchObject({ outcome: "refused", code: "host-ambiguous" });
    await refused.stop();

    const asked: string[][] = [];
    const chosen = await setup({ keys, chooseKey: async (ids) => (asked.push(ids), "key-2") });
    const second = await connectThrough(chosen.port, "api.test:443");
    expect(second.status).toBe(200);
    await tlsRequest(second.socket, { servername: "api.test", ca: deviceCa.certificatePem });
    expect(asked).toEqual([["key-1", "key-2"]]);
    expect(chosen.origin.seen[0].headers.authorization).toBe("Bearer sk-second-9876543210");
    await chosen.stop();
  });

  it("substitutes the placeholder in the path, the headers and a small body, and only there", async () => {
    const s = await setup({ keys: [key({ value: "sk/with/slash-123456" })] });
    const { socket } = await connectThrough(s.port, "api.test:443");
    await tlsRequest(socket, {
      servername: "api.test",
      ca: deviceCa.certificatePem,
      method: "POST",
      path: `/v1/${PLACEHOLDER}/items?token=${PLACEHOLDER}`,
      headers: { "X-Echo": `pre-${PLACEHOLDER}-post`, "Content-Type": "application/json" },
      body: JSON.stringify({ k: PLACEHOLDER }),
    });
    const seen = s.origin.seen[0];
    expect(seen.url).toBe("/v1/sk%2Fwith%2Fslash-123456/items?token=sk%2Fwith%2Fslash-123456");
    expect(seen.headers["x-echo"]).toBe("pre-sk/with/slash-123456-post");
    expect(JSON.parse(seen.body.toString())).toEqual({ k: "sk/with/slash-123456" });
    expect(seen.headers["content-length"]).toBe(String(seen.body.length));
    await s.stop();
  });

  it("forwards a body over 1 MiB unchanged with the header still attached, and says so locally", async () => {
    const s = await setup();
    const { socket } = await connectThrough(s.port, "api.test:443");
    const big = Buffer.alloc(MAX_SCANNED_BODY_BYTES + 10, "a");
    big.write(PLACEHOLDER, 0);
    await tlsRequest(socket, {
      servername: "api.test",
      ca: deviceCa.certificatePem,
      method: "POST",
      body: big,
      headers: { "Content-Length": String(big.length) },
    });
    expect(s.origin.seen[0].body.subarray(0, PLACEHOLDER.length).toString()).toBe(PLACEHOLDER);
    expect(s.origin.seen[0].headers.authorization).toBe("Bearer sk-live-0123456789");
    expect(s.events.some((e) => e.code === "body-not-scanned")).toBe(true);
    await s.stop();
  });

  it("does not scan a body that has a Content-Encoding", async () => {
    const s = await setup();
    const { socket } = await connectThrough(s.port, "api.test:443");
    await tlsRequest(socket, {
      servername: "api.test",
      ca: deviceCa.certificatePem,
      method: "POST",
      body: PLACEHOLDER,
      headers: { "Content-Encoding": "gzip" },
    });
    expect(s.origin.seen[0].body.toString()).toBe(PLACEHOLDER);
    expect(s.events.some((e) => e.code === "body-not-scanned")).toBe(true);
    await s.stop();
  });

  it("hands a redirect back to the client instead of following it", async () => {
    const s = await setup({
      respond: (_req, res) => {
        res.writeHead(302, { Location: "https://elsewhere.test/landing" });
        res.end();
      },
    });
    const { socket } = await connectThrough(s.port, "api.test:443");
    const reply = await tlsRequest(socket, { servername: "api.test", ca: deviceCa.certificatePem });
    expect(reply.status).toBe(302);
    expect(reply.headers.location).toBe("https://elsewhere.test/landing");
    expect(s.origin.seen).toHaveLength(1);
    await s.stop();
  });

  it("fails the request when the origin's certificate is not trusted, without falling back to a tunnel", async () => {
    const s = await setup({ upstreamTrusted: false });
    const { socket } = await connectThrough(s.port, "api.test:443");
    const reply = await tlsRequest(socket, { servername: "api.test", ca: deviceCa.certificatePem });
    expect(reply.status).toBe(502);
    expect(JSON.parse(reply.body)).toEqual({ code: "tls-untrusted" });
    expect(s.origin.seen).toHaveLength(0);
    await s.stop();
  });

  it("answers 501 to a WebSocket upgrade on a matching host", async () => {
    const s = await setup();
    const { socket } = await connectThrough(s.port, "api.test:443");
    const reply = await tlsRequest(socket, {
      servername: "api.test",
      ca: deviceCa.certificatePem,
      headers: { Connection: "Upgrade", Upgrade: "websocket" },
    }).catch(() => ({ status: 501 }));
    expect(reply.status).toBe(501);
    expect(s.origin.seen).toHaveLength(0);
    await s.stop();
  });

  it("closes the listener and every accepted socket on stop", async () => {
    const s = await setup();
    const { socket } = await connectThrough(s.port, "api.test:443");
    const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
    await s.proxy.stop();
    await closed;
    await expect(connectThrough(s.port, "api.test:443")).rejects.toBeDefined();
    await s.origin.close();
  });

  it("attaches a key to a plain request to a listed loopback host and port", async () => {
    const seen: http.IncomingHttpHeaders[] = [];
    const target = http.createServer((req, res) => {
      seen.push(req.headers);
      res.end("plain");
    });
    await new Promise<void>((r) => target.listen(0, "127.0.0.1", r));
    const targetPort = (target.address() as net.AddressInfo).port;
    const proxy = new KeyProxy({
      port: 0,
      credential: CREDENTIAL,
      ca: deviceCa,
      keys: () => [key({ allowedHosts: [`127.0.0.1:${targetPort}`] })],
      placeholders: () => ({}),
    });
    const proxyPort = await proxy.start();
    const reply = await new Promise<string>((resolve, reject) => {
      http
        .get(
          {
            host: "127.0.0.1",
            port: proxyPort,
            path: `http://127.0.0.1:${targetPort}/x`,
            headers: {
              "Proxy-Authorization":
                "Basic " + Buffer.from(`vowkey:${CREDENTIAL}`).toString("base64"),
            },
          },
          (res) => {
            const c: Buffer[] = [];
            res.on("data", (d: Buffer) => c.push(d));
            res.on("end", () => resolve(Buffer.concat(c).toString()));
          },
        )
        .on("error", reject);
    });
    expect(reply).toBe("plain");
    expect(seen[0].authorization).toBe("Bearer sk-live-0123456789");
    await proxy.stop();
    target.closeAllConnections();
    await new Promise<void>((r) => target.close(() => r()));
  });
});
