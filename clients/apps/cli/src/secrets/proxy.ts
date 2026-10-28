import * as crypto from "crypto";
import * as dns from "dns";
import * as http from "http";
import * as https from "https";
import * as net from "net";
import { Duplex } from "stream";
import * as tls from "tls";

import { DeviceCa } from "./device-ca";
import { SecretsError, SecretsErrorCode } from "./errors";
import { HostBoundKey, normalizeHostname, RequestTarget, selectKey } from "./host-match";
import { buildSendHeader, hasControlCharacter } from "./send-style";

/** The largest request body the proxy reads to substitute a placeholder in. */
export const MAX_SCANNED_BODY_BYTES = 1024 * 1024;

export interface ProxyKey extends HostBoundKey {
  name: string;
  value: string;
  sendStyle: string;
  headerName?: string;
  basicUsername?: string;
}

export interface ProxyEvent {
  eventId: string;
  method: string;
  host: string;
  port: number;
  /** The key item that matched, or null for a host no key lists. */
  itemId: string | null;
  outcome: "forwarded" | "tunnelled" | "refused" | "error";
  /** A local code, or the status the proxy itself generated. Never an upstream body. */
  code?: SecretsErrorCode;
  status?: number;
}

export interface ProxyOptions {
  port: number;
  /** The credential in `HTTPS_PROXY`. Without it a request gets 407. */
  credential: string;
  ca: DeviceCa;
  keys: () => ProxyKey[];
  /** Per key item, the stand-in a client may put where the key belongs. */
  placeholders: () => Record<string, string>;
  /** Asks which of several matching keys to use. No answer means neither is attached. */
  chooseKey?: (target: RequestTarget, itemIds: string[]) => Promise<string | null>;
  onEvent?: (event: ProxyEvent) => void;
  /** Extra roots to trust for the origin, beside the machine's. */
  upstreamCa?: string | string[];
  /** Resolves a host once, so the origin connection is pinned to that address. */
  lookup?: (host: string) => Promise<string>;
  /** Lets a test reach an origin on a port other than the one the client names. */
  mapPort?: (host: string, port: number) => number;
}

const HOP_BY_HOP = new Set([
  "proxy-authorization",
  "proxy-connection",
  "proxy-authenticate",
  "keep-alive",
  "te",
  "trailer",
]);

function sameAddress(a: string | undefined, b: string): boolean {
  const norm = (x: string) => x.replace(/^::ffff:/, "").toLowerCase();
  return a != null && norm(a) === norm(b);
}

function parseAuthority(authority: string): { hostname: string; port: number } | null {
  const bracket = /^\[([^\]]+)\](?::(\d+))?$/.exec(authority);
  if (bracket != null) {
    return { hostname: bracket[1].toLowerCase(), port: bracket[2] ? Number(bracket[2]) : 443 };
  }
  const colon = authority.lastIndexOf(":");
  if (colon === -1) {
    return { hostname: authority.toLowerCase(), port: 443 };
  }
  const port = Number(authority.slice(colon + 1));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }
  return { hostname: authority.slice(0, colon).toLowerCase(), port };
}

function replaceAll(haystack: Buffer, needle: Buffer, replacement: Buffer): Buffer {
  if (needle.length === 0 || haystack.indexOf(needle) === -1) {
    return haystack;
  }
  const parts: Buffer[] = [];
  let at = 0;
  for (;;) {
    const found = haystack.indexOf(needle, at);
    if (found === -1) {
      parts.push(haystack.subarray(at));
      break;
    }
    parts.push(haystack.subarray(at, found), replacement);
    at = found + needle.length;
  }
  return Buffer.concat(parts);
}

interface InterceptContext {
  hostname: string;
  port: number;
  key: ProxyKey;
  address: string;
  /** The name the client sent in its TLS hello, lowercase. Empty when it sent none. */
  sni: string;
}

/**
 * A loopback proxy that attaches a key to requests for the key's hosts and to no others. For a
 * host a key lists, it terminates TLS with the device CA, checks that the CONNECT authority, the
 * request's own host and the client's SNI name the same host, attaches the key's send style and
 * substitutes the key's placeholder, then talks to the address it resolved for that host and
 * verifies the origin's certificate against the machine's roots. Every other host is a blind
 * tunnel. HTTP/2 and WebSocket are refused for a matching host rather than passed unscanned.
 */
export class KeyProxy {
  private server: http.Server | null = null;
  private readonly inner: http.Server;
  private readonly sockets = new Set<Duplex>();
  private readonly contexts = new WeakMap<Duplex, InterceptContext>();

  constructor(private readonly options: ProxyOptions) {
    this.inner = http.createServer((req, res) => {
      void this.handleIntercepted(req, res);
    });
    this.inner.on("upgrade", (req, socket) => {
      socket.end("HTTP/1.1 501 Not Implemented\r\nConnection: close\r\n\r\n");
    });
    this.inner.on("clientError", (_error, socket) => socket.destroy());
  }

  get listening(): boolean {
    return this.server?.listening === true;
  }

  async start(): Promise<number> {
    if (this.server != null) {
      throw new SecretsError("unavailable", "The proxy is already listening.");
    }
    const server = http.createServer((req, res) => {
      void this.handlePlain(req, res);
    });
    server.on("connect", (req, socket, head) => {
      void this.handleConnect(req, socket as net.Socket, head);
    });
    server.on("connection", (socket) => this.track(socket));
    server.on("clientError", (_error, socket) => socket.destroy());
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.options.port, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    this.server = server;
    return (server.address() as net.AddressInfo).port;
  }

  /** Closes the listener and every accepted socket, so nothing forwards without its key. */
  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    for (const socket of this.sockets) {
      socket.destroy();
    }
    this.sockets.clear();
    if (server != null) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  private track(socket: Duplex) {
    this.sockets.add(socket);
    socket.once("close", () => this.sockets.delete(socket));
  }

  private emit(event: Omit<ProxyEvent, "eventId">) {
    this.options.onEvent?.({ eventId: crypto.randomUUID(), ...event });
  }

  private authorized(header: string | undefined): boolean {
    if (header == null || !/^basic /i.test(header)) {
      return false;
    }
    const decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
    const supplied = Buffer.from(decoded.slice(decoded.indexOf(":") + 1));
    const expected = Buffer.from(this.options.credential);
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
  }

  private async resolve(host: string): Promise<string> {
    if (this.options.lookup != null) {
      return await this.options.lookup(host);
    }
    if (net.isIP(host)) {
      return host;
    }
    return (await dns.promises.lookup(host)).address;
  }

  private async selectFor(
    target: RequestTarget,
  ): Promise<{ kind: "none" } | { kind: "key"; key: ProxyKey } | { kind: "ambiguous" }> {
    const keys = this.options.keys();
    const selection = selectKey(keys, target);
    if (selection.kind === "none") {
      return { kind: "none" };
    }
    if (selection.kind === "key") {
      return { kind: "key", key: keys.find((k) => k.itemId === selection.itemId)! };
    }
    const chosen = (await this.options.chooseKey?.(target, selection.itemIds)) ?? null;
    const key = chosen == null ? undefined : keys.find((k) => k.itemId === chosen);
    return key != null && selection.itemIds.includes(chosen!)
      ? { kind: "key", key }
      : { kind: "ambiguous" };
  }

  // ---- CONNECT -----------------------------------------------------------------------------

  private async handleConnect(req: http.IncomingMessage, client: net.Socket, head: Buffer) {
    const refuse = (status: number, text: string, code?: SecretsErrorCode) => {
      const body = JSON.stringify({ code: code ?? "refused" });
      client.end(
        `HTTP/1.1 ${status} ${text}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
      );
    };
    if (!this.authorized(req.headers["proxy-authorization"])) {
      client.end(
        'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="vowkey"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n',
      );
      return;
    }
    const authority = parseAuthority(req.url ?? "");
    if (authority == null) {
      refuse(400, "Bad Request");
      return;
    }
    const target: RequestTarget = { ...authority, scheme: "https" };
    const selected = await this.selectFor(target);

    if (selected.kind === "none") {
      void this.tunnel(client, head, authority.hostname, authority.port);
      return;
    }
    if (selected.kind === "ambiguous") {
      this.emit({
        method: "CONNECT",
        host: authority.hostname,
        port: authority.port,
        itemId: null,
        outcome: "refused",
        code: "host-ambiguous",
        status: 409,
      });
      refuse(409, "Conflict", "host-ambiguous");
      return;
    }

    let address: string;
    try {
      address = await this.resolve(authority.hostname);
    } catch {
      refuse(502, "Bad Gateway", "unavailable");
      return;
    }
    const context = await this.options.ca.contextFor(authority.hostname);
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    const intercept: InterceptContext = {
      hostname: authority.hostname,
      port: authority.port,
      key: selected.key,
      address,
      sni: "",
    };
    const secure = new tls.TLSSocket(client, {
      isServer: true,
      // The certificate is always the CONNECT host's; the name the client asked for is recorded
      // and compared once the request arrives.
      SNICallback: (name, done) => {
        intercept.sni = name.toLowerCase();
        done(null, context);
      },
      secureContext: context,
      ALPNProtocols: ["http/1.1"],
    });
    this.track(secure);
    this.contexts.set(secure, intercept);
    secure.on("error", () => secure.destroy());
    if (head.length > 0) {
      secure.unshift(head);
    }
    this.inner.emit("connection", secure);
  }

  /** A host no key lists is passed through as bytes the proxy never looks at. */
  private async tunnel(client: net.Socket, head: Buffer, host: string, port: number) {
    let address: string;
    try {
      address = await this.resolve(host);
    } catch {
      client.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
      return;
    }
    const upstream = net.connect(this.options.mapPort?.(host, port) ?? port, address);
    this.track(upstream);
    upstream.once("connect", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) {
        upstream.write(head);
      }
      upstream.pipe(client);
      client.pipe(upstream);
      this.emit({ method: "CONNECT", host, port, itemId: null, outcome: "tunnelled" });
    });
    const fail = () => {
      if (!client.destroyed) {
        client.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
      }
      upstream.destroy();
    };
    upstream.once("error", fail);
    client.once("error", () => upstream.destroy());
    client.once("close", () => upstream.destroy());
  }

  // ---- A request inside an intercepted tunnel ----------------------------------------------

  private async handleIntercepted(req: http.IncomingMessage, res: http.ServerResponse) {
    const ctx = this.contexts.get(req.socket) ?? this.contexts.get(req.socket as Duplex);
    if (ctx == null) {
      res.destroy();
      return;
    }
    const deny = (status: number, code: SecretsErrorCode) => {
      this.emit({
        method: req.method ?? "",
        host: ctx.hostname,
        port: ctx.port,
        itemId: ctx.key.itemId,
        outcome: "refused",
        code,
        status,
      });
      const body = JSON.stringify({ code });
      res.writeHead(status, { "Content-Type": "application/json", Connection: "close" });
      res.end(body);
      req.socket.destroy();
    };

    // Three names for the host have to agree: CONNECT, the request itself and the SNI.
    let requestHost: { hostname: string; port: number } | null;
    try {
      requestHost = /^https?:\/\//i.test(req.url ?? "")
        ? (() => {
            const u = new URL(req.url!);
            return {
              hostname: normalizeHostname(u.hostname),
              port: u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80,
            };
          })()
        : parseAuthority(req.headers.host ?? "");
    } catch {
      requestHost = null;
    }
    const sniOk = net.isIP(ctx.hostname) ? true : ctx.sni === ctx.hostname;
    if (
      requestHost == null ||
      requestHost.hostname !== ctx.hostname ||
      requestHost.port !== ctx.port ||
      !sniOk
    ) {
      deny(403, "host-mismatch");
      return;
    }
    if (req.headers.upgrade != null || req.headers["http2-settings"] != null) {
      this.emit({
        method: req.method ?? "",
        host: ctx.hostname,
        port: ctx.port,
        itemId: ctx.key.itemId,
        outcome: "refused",
        status: 501,
      });
      res.writeHead(501, { Connection: "close" });
      res.end();
      req.socket.destroy();
      return;
    }

    try {
      await this.forward(req, res, ctx);
    } catch (e) {
      if (e instanceof SecretsError) {
        deny(e.code === "host-mismatch" ? 403 : 502, e.code);
        return;
      }
      this.emit({
        method: req.method ?? "",
        host: ctx.hostname,
        port: ctx.port,
        itemId: ctx.key.itemId,
        outcome: "error",
      });
      if (!res.headersSent) {
        res.writeHead(502, { Connection: "close" });
      }
      res.end();
    }
  }

  private async forward(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    ctx: InterceptContext,
  ) {
    const { key } = ctx;
    const placeholder = this.options.placeholders()[key.itemId];

    // Rewrite the request target, then the headers, then the body.
    let target = /^https?:\/\//i.test(req.url ?? "")
      ? (() => {
          const u = new URL(req.url!);
          return u.pathname + u.search;
        })()
      : (req.url ?? "/");
    if (placeholder != null && target.includes(placeholder)) {
      if (hasControlCharacter(key.value)) {
        throw new SecretsError("refused", "The key cannot be placed in a request target.");
      }
      target = target.split(placeholder).join(key.value.replace(/\//g, "%2F"));
    }

    const headers: http.OutgoingHttpHeaders = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (HOP_BY_HOP.has(name) || value == null) {
        continue;
      }
      const text = Array.isArray(value) ? value.join(", ") : value;
      if (placeholder != null && text.includes(placeholder)) {
        if (hasControlCharacter(key.value)) {
          throw new SecretsError("refused", "The key cannot be placed in a header.");
        }
        headers[name] = text.split(placeholder).join(key.value);
      } else {
        headers[name] = value;
      }
    }
    const send = buildSendHeader(key);
    for (const existing of Object.keys(headers)) {
      if (existing.toLowerCase() === send.name.toLowerCase()) {
        delete headers[existing];
      }
    }
    headers[send.name] = send.value;

    const encoded = req.headers["content-encoding"] != null;
    const declared =
      req.headers["content-length"] != null ? Number(req.headers["content-length"]) : null;
    const hasBody =
      declared !== 0 && (declared != null || req.headers["transfer-encoding"] != null);
    let scanned: Buffer | null = null;
    let scanSkipped = false;
    let pending: Buffer[] = [];

    if (hasBody) {
      if (encoded || (declared != null && declared > MAX_SCANNED_BODY_BYTES)) {
        scanSkipped = true;
      } else {
        // Read up to the limit; a body that turns out larger is forwarded as it is.
        let size = 0;
        for await (const chunk of req) {
          const buf = Buffer.from(chunk as Buffer);
          size += buf.length;
          pending.push(buf);
          if (size > MAX_SCANNED_BODY_BYTES) {
            scanSkipped = true;
            break;
          }
        }
        if (!scanSkipped) {
          let body: Buffer = Buffer.concat(pending);
          if (placeholder != null) {
            body = replaceAll(body, Buffer.from(placeholder), Buffer.from(key.value));
          }
          scanned = body;
          pending = [];
          headers["content-length"] = String(body.length);
          delete headers["transfer-encoding"];
        }
      }
    }
    if (scanSkipped) {
      this.emit({
        method: req.method ?? "",
        host: ctx.hostname,
        port: ctx.port,
        itemId: key.itemId,
        outcome: "forwarded",
        code: "body-not-scanned",
      });
    }

    const upstreamPort = this.options.mapPort?.(ctx.hostname, ctx.port) ?? ctx.port;
    await new Promise<void>((resolve, reject) => {
      const upstream = https.request(
        {
          host: ctx.address,
          port: upstreamPort,
          servername: net.isIP(ctx.hostname) ? undefined : ctx.hostname,
          method: req.method,
          path: target,
          headers,
          ca: this.options.upstreamCa,
          rejectUnauthorized: true,
          agent: false,
        },
        (response) => {
          if (!sameAddress(response.socket.remoteAddress, ctx.address)) {
            response.destroy();
            reject(new SecretsError("host-mismatch", "The origin is not at the address resolved."));
            return;
          }
          this.emit({
            method: req.method ?? "",
            host: ctx.hostname,
            port: ctx.port,
            itemId: key.itemId,
            outcome: "forwarded",
            status: response.statusCode,
          });
          // Redirects go back to the client; the key is never copied onto another host.
          res.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(res);
          response.once("end", resolve);
          response.once("error", reject);
        },
      );
      upstream.on("error", (error: NodeJS.ErrnoException) => {
        const untrusted =
          error.code != null && /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS/.test(error.code);
        reject(
          untrusted
            ? new SecretsError("tls-untrusted", "The origin certificate is not trusted.")
            : error,
        );
      });
      req.socket.once("close", () => upstream.destroy());

      if (scanned != null) {
        upstream.end(scanned);
      } else if (scanSkipped) {
        for (const chunk of pending) {
          upstream.write(chunk);
        }
        pending = [];
        req.pipe(upstream);
      } else {
        upstream.end();
      }
    });
  }

  // ---- A plain proxied request (absolute-form) ---------------------------------------------

  private async handlePlain(req: http.IncomingMessage, res: http.ServerResponse) {
    if (!this.authorized(req.headers["proxy-authorization"])) {
      res.writeHead(407, { "Proxy-Authenticate": 'Basic realm="vowkey"', "Content-Length": "0" });
      res.end();
      return;
    }
    let url: URL;
    try {
      url = new URL(req.url ?? "");
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    if (url.protocol !== "http:") {
      res.writeHead(400);
      res.end();
      return;
    }
    const port = url.port ? Number(url.port) : 80;
    const hostname = normalizeHostname(url.hostname);
    const selected = await this.selectFor({ hostname, port, scheme: "http" });

    if (selected.kind === "ambiguous") {
      this.emit({
        method: req.method ?? "",
        host: hostname,
        port,
        itemId: null,
        outcome: "refused",
        code: "host-ambiguous",
        status: 409,
      });
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ code: "host-ambiguous" }));
      return;
    }
    if (req.headers.upgrade != null && selected.kind === "key") {
      res.writeHead(501);
      res.end();
      return;
    }

    const headers: http.OutgoingHttpHeaders = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (!HOP_BY_HOP.has(name) && value != null) {
        headers[name] = value;
      }
    }
    let path = url.pathname + url.search;
    if (selected.kind === "key") {
      const { key } = selected;
      const placeholder = this.options.placeholders()[key.itemId];
      try {
        const send = buildSendHeader(key);
        for (const existing of Object.keys(headers)) {
          if (existing.toLowerCase() === send.name.toLowerCase()) {
            delete headers[existing];
          }
        }
        headers[send.name] = send.value;
        if (placeholder != null) {
          path = path.split(placeholder).join(key.value.replace(/\//g, "%2F"));
          for (const [name, value] of Object.entries(headers)) {
            if (typeof value === "string" && value.includes(placeholder)) {
              headers[name] = value.split(placeholder).join(key.value);
            }
          }
        }
      } catch {
        res.writeHead(502);
        res.end();
        return;
      }
    }
    const upstream = http.request(
      {
        host: hostname,
        port: this.options.mapPort?.(hostname, port) ?? port,
        method: req.method,
        path,
        headers,
        agent: false,
      },
      (response) => {
        this.emit({
          method: req.method ?? "",
          host: hostname,
          port,
          itemId: selected.kind === "key" ? selected.key.itemId : null,
          outcome: "forwarded",
          status: response.statusCode,
        });
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) {
        res.writeHead(502);
      }
      res.end();
    });
    upstream.on("socket", (socket) => this.track(socket));
    req.pipe(upstream);
  }
}
