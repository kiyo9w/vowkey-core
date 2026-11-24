import * as Sentry from "@sentry/browser";
import type { ErrorEvent, StackFrame } from "@sentry/core";

const URL_IN_TEXT = /[a-z][a-z0-9+.-]*:\/\/\S+/gi;
const ERROR_CLASSES: Record<string, true> = {
  Error: true, TypeError: true, RangeError: true, ReferenceError: true, SyntaxError: true,
  URIError: true, EvalError: true, AggregateError: true, DOMException: true,
};

/** Retains diagnostic structure; exception messages may contain decrypted values. */
export function reduceCrashReport(event: ErrorEvent): ErrorEvent | null {
  const exception = event.exception?.values?.[0];
  const frames = (exception?.stacktrace?.frames ?? [])
    .map(scrubFrame)
    .filter((frame): frame is StackFrame => frame != null);
  const name = exception?.type;
  const message = name && Object.prototype.hasOwnProperty.call(ERROR_CLASSES, name) ? name : "Error";
  if (!exception && frames.length === 0) {
    return null;
  }
  const osName = event.contexts?.os && typeof event.contexts.os.name === "string" ? event.contexts.os.name : undefined;
  return {
    event_id: event.event_id,
    timestamp: event.timestamp,
    platform: event.platform,
    type: undefined,
    message,
    release: event.release,
    exception: { values: [{ type: message, value: message, stacktrace: { frames } }] },
    contexts: osName ? { os: { name: osName } } : undefined,
  };
}

function scrub(value: string | undefined): string | undefined {
  const cleaned = value?.replace(URL_IN_TEXT, "").trim();
  return cleaned ? cleaned : undefined;
}

function scrubFrame(frame: StackFrame): StackFrame | null {
  const name = scrub(frame.function);
  return name ? { function: name } : null;
}

let sending = false;
let activeDsn = "";
let activeClient: { captureException: (error: unknown) => void; close: (timeout?: number) => PromiseLike<unknown> } | null = null;
let handlersBound = false;

function bindGlobalHandlers(): void {
  if (handlersBound) {
    return;
  }
  handlersBound = true;
  // The bundled app can contain more than one @sentry/browser module instance, so
  // Sentry.getClient() from this module does not reliably see the client this module
  // initialized. Keep the client reference ourselves and listen for global errors
  // directly instead of relying on globalHandlersIntegration.
  window.addEventListener("error", (event) => captureCrash(event.error ?? event.message));
  window.addEventListener("unhandledrejection", (event) => captureCrash(event.reason));
}

/**
 * Starts the Sentry SDK only when the switch is on and a DSN is configured.
 * Turning the switch off drops the transport, so nothing further leaves.
 */
export function startCrashReports(enabled: boolean, dsn: string, metadata?: { release: string; os: string }): void {
  console.log("[crash-probe] startCrashReports", enabled, dsn);
  const client = activeClient;
  if (client && (!sending || activeDsn !== dsn)) {
    void client.close(0);
    activeClient = null;
    activeDsn = "";
  }
  if (!sending) {
    return;
  }
  if (activeClient) {
    return;
  }
  // Sentry.init returns the client it created; the bundled app can hold several
  // @sentry/browser module instances, so Sentry.getClient() may look at a different
  // one. Keep the returned client and use it directly.
  activeClient = Sentry.init({
    dsn,
    release: metadata?.release,
    initialScope: metadata ? { contexts: { os: { name: metadata.os } } } : undefined,
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    maxBreadcrumbs: 0,
    attachStacktrace: false,
    sendClientReports: false,
    defaultIntegrations: false,
    beforeSend: reduceCrashReport,
  }) as unknown as typeof activeClient;
  activeDsn = dsn;
  bindGlobalHandlers();
}

/** Sends one error through the SDK. The switch and the reducer decide whether anything leaves. */
export function captureCrash(error: unknown): void {
  if (sending && activeClient) {
    activeClient.captureException(error);
  }
}
