import { parseWebSocketMessage, type WebSocketMessage } from "@/lib/contracts";

const CONNECT_TIMEOUT_MS = 10_000;
const RESULT_TIMEOUT_MS = 75_000;
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_BASE_DELAY_MS = 500;

export type SessionQuery = {
  photoId: string;
  eventId: string;
  bgId: string;
  frameId: string;
};

export type ManagedSessionOptions = {
  /** Overall time to keep waiting for a result across all reconnects. */
  resultTimeoutMs?: number;
  /** How many times to reconnect after an unexpected drop. */
  reconnectAttempts?: number;
  /** Base delay for the exponential reconnect backoff. */
  baseDelayMs?: number;
};

export type ManagedSession = {
  /** Resolves the first time the socket opens; rejects if it never connects. */
  connected: Promise<void>;
  /**
   * Resolves with the first result message. Survives mid-session drops by
   * reconnecting with the same photoId, so a retried $connect re-maps the
   * connection and the finished photo still reaches the kiosk.
   */
  result: Promise<WebSocketMessage>;
  /** Stop reconnecting, clear timers, and close the socket. */
  close: () => void;
};

/**
 * Connect URL from the shared contract, plus the asset choice the processor
 * reads from the session item. Tom's $connect handler should persist
 * photoId, eventId, bgId, and frameId from this query string.
 */
export function sessionSocketUrl(base: string, query: SessionQuery): string {
  const url = new URL(base);
  url.searchParams.set("photoId", query.photoId);
  url.searchParams.set("eventId", query.eventId);
  url.searchParams.set("bgId", query.bgId);
  url.searchParams.set("frameId", query.frameId);
  return url.toString();
}

/**
 * Opens a booth session that stays alive until a result arrives. If the socket
 * drops mid-session, it reconnects automatically (same photoId) with an
 * exponential backoff so the guest isn't stuck, giving up only after the
 * configured number of attempts or the overall result timeout.
 */
export function openManagedSession(
  base: string,
  query: SessionQuery,
  options: ManagedSessionOptions = {},
): ManagedSession {
  const resultTimeoutMs = options.resultTimeoutMs ?? RESULT_TIMEOUT_MS;
  const maxAttempts = options.reconnectAttempts ?? MAX_RECONNECT_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? RECONNECT_BASE_DELAY_MS;

  let socket: WebSocket | null = null;
  let closed = false;
  let attempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let resultTimer: ReturnType<typeof setTimeout> | null = null;

  let resolveConnected!: () => void;
  let rejectConnected!: (error: Error) => void;
  const connected = new Promise<void>((resolve, reject) => {
    resolveConnected = resolve;
    rejectConnected = reject;
  });

  let resolveResult!: (message: WebSocketMessage) => void;
  let rejectResult!: (error: Error) => void;
  const result = new Promise<WebSocketMessage>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  function teardown() {
    closed = true;
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (resultTimer !== null) {
      clearTimeout(resultTimer);
      resultTimer = null;
    }
    if (socket !== null) {
      const current = socket;
      socket = null;
      current.close();
    }
  }

  // Rejects both promises and stops. Rejecting an already-settled promise is a
  // harmless no-op, so callers can safely await either one.
  function fail(error: Error) {
    if (closed) return;
    rejectConnected(error);
    rejectResult(error);
    teardown();
  }

  function scheduleReconnect(error: Error) {
    if (closed) return;
    if (attempts >= maxAttempts) {
      fail(error);
      return;
    }
    attempts += 1;
    const delay = baseDelayMs * 2 ** (attempts - 1);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function connect() {
    if (closed) return;

    let next: WebSocket;
    try {
      next = new WebSocket(sessionSocketUrl(base, query));
    } catch {
      fail(new Error("WebSocket URL is invalid."));
      return;
    }
    socket = next;

    const connectTimer = setTimeout(() => {
      // Give up on this attempt; the close handler drives the reconnect.
      next.close();
    }, CONNECT_TIMEOUT_MS);

    next.addEventListener(
      "open",
      () => {
        clearTimeout(connectTimer);
        if (closed || socket !== next) return;
        resolveConnected();
      },
      { once: true },
    );

    next.addEventListener("message", (event: MessageEvent) => {
      if (closed || socket !== next) return;
      const message = parseWebSocketMessage(event.data);
      if (!message) return;
      resolveResult(message);
      teardown();
    });

    // A failed connect or a mid-session drop both surface as "close"; reconnect
    // from there so a single path owns the retry decision.
    next.addEventListener("close", () => {
      clearTimeout(connectTimer);
      if (closed || socket !== next) return;
      socket = null;
      scheduleReconnect(new Error("Connection closed before the photo was ready."));
    });
  }

  resultTimer = setTimeout(() => {
    fail(new Error("Processing timed out."));
  }, resultTimeoutMs);

  connect();

  return {
    connected,
    result,
    close: teardown,
  };
}
