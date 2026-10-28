import { parseWebSocketMessage, type WebSocketMessage } from "@/lib/contracts";

const CONNECT_TIMEOUT_MS = 10_000;
const RESULT_TIMEOUT_MS = 75_000;

export type SessionQuery = {
  photoId: string;
  eventId: string;
  bgId: string;
  frameId: string;
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

export function openSession(base: string, query: SessionQuery): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(sessionSocketUrl(base, query));
    } catch {
      reject(new Error("WebSocket URL is invalid."));
      return;
    }

    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("Could not connect to the booth."));
    }, CONNECT_TIMEOUT_MS);

    ws.addEventListener(
      "open",
      () => {
        clearTimeout(timer);
        resolve(ws);
      },
      { once: true },
    );

    ws.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        reject(new Error("Could not connect to the booth."));
      },
      { once: true },
    );
  });
}

export function waitForResult(ws: WebSocket): Promise<WebSocketMessage> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.removeEventListener("message", onMessage);
      ws.removeEventListener("close", onClose);
      settle();
    };

    const timer = setTimeout(() => {
      finish(() => reject(new Error("Processing timed out.")));
    }, RESULT_TIMEOUT_MS);

    function onMessage(event: MessageEvent) {
      const message = parseWebSocketMessage(event.data);
      if (!message) return;
      finish(() => resolve(message));
    }

    function onClose() {
      finish(() => reject(new Error("Connection closed before the photo was ready.")));
    }

    ws.addEventListener("message", onMessage);
    ws.addEventListener("close", onClose);
  });
}
