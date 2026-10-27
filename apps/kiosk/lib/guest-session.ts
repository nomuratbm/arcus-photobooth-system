import { captureJpeg } from "@/lib/capture";
import { finalImageUrl, type WebSocketMessage } from "@/lib/contracts";
import { openSession, waitForResult } from "@/lib/socket";
import { requestPresign, uploadJpeg } from "@/lib/upload";

export const COUNTDOWN_SECONDS = 10;

export type GuestPhase =
  | { type: "idle" }
  | { type: "countdown"; seconds: number }
  | { type: "uploading" }
  | { type: "processing" }
  | { type: "done"; url: string }
  | { type: "error"; message: string };

export type GuestSessionInput = {
  video: HTMLVideoElement;
  wsUrl: string;
  cloudfrontDomain: string;
  eventId: string;
  frameId: string;
  bgId: string;
  onPhase: (phase: GuestPhase) => void;
};

type Run = {
  cancelled: boolean;
  settled: boolean;
  socket: WebSocket | null;
  timer: number | null;
  result: Promise<WebSocketMessage> | null;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Photo processing failed.";
}

/**
 * Owns one guest photo: register during the countdown, capture when it ends,
 * then upload and wait for the finished image. The booth only renders phases.
 */
export function startGuestSession(input: GuestSessionInput): { cancel: () => void } {
  const { video, wsUrl, cloudfrontDomain, eventId, frameId, bgId, onPhase } = input;

  if (!wsUrl) {
    onPhase({ type: "error", message: "WebSocket URL is not configured." });
    return { cancel() {} };
  }

  if (!cloudfrontDomain) {
    onPhase({ type: "error", message: "CloudFront domain is not configured." });
    return { cancel() {} };
  }

  const photoId = crypto.randomUUID();
  const run: Run = {
    cancelled: false,
    settled: false,
    socket: null,
    timer: null,
    result: null,
  };

  const sessionPromise = openSession(wsUrl, { photoId, eventId, bgId, frameId });
  const presignPromise = requestPresign(photoId);

  const releaseSocket = (ws: WebSocket | null) => {
    ws?.close();
    if (run.socket === ws) run.socket = null;
  };

  const clearTimer = () => {
    if (run.timer === null) return;
    window.clearInterval(run.timer);
    run.timer = null;
  };

  const fail = (error: unknown) => {
    if (run.cancelled || run.settled) return;
    run.settled = true;
    clearTimer();
    onPhase({ type: "error", message: errorMessage(error) });
    if (run.socket) {
      releaseSocket(run.socket);
      return;
    }
    void sessionPromise.then((ws) => ws.close()).catch(() => undefined);
  };

  sessionPromise.then(
    (ws) => {
      if (run.cancelled || run.settled) {
        ws.close();
        return;
      }
      run.socket = ws;
      run.result = waitForResult(ws);
      void run.result.catch(() => undefined);
    },
    (error: unknown) => {
      fail(error);
    },
  );

  presignPromise.catch((error: unknown) => {
    fail(error);
  });

  let remaining = COUNTDOWN_SECONDS;
  onPhase({ type: "countdown", seconds: remaining });

  run.timer = window.setInterval(() => {
    if (run.cancelled || run.settled) return;
    remaining -= 1;
    if (remaining > 0) {
      onPhase({ type: "countdown", seconds: remaining });
      return;
    }
    clearTimer();
    void captureAndUpload();
  }, 1000);

  async function captureAndUpload() {
    if (run.cancelled || run.settled) return;
    onPhase({ type: "uploading" });

    try {
      const [ws, uploadUrl] = await Promise.all([sessionPromise, presignPromise]);
      if (run.cancelled || run.settled) {
        releaseSocket(ws);
        return;
      }

      run.socket = ws;
      const resultPromise = run.result ?? waitForResult(ws);
      run.result = resultPromise;
      void resultPromise.catch(() => undefined);

      const blob = await captureJpeg(video);
      if (run.cancelled || run.settled) {
        releaseSocket(ws);
        return;
      }

      await uploadJpeg(uploadUrl, blob);
      if (run.cancelled || run.settled) {
        releaseSocket(ws);
        return;
      }

      onPhase({ type: "processing" });
      const message = await resultPromise;
      if (run.cancelled || run.settled) return;

      run.settled = true;
      if (message.status === "error") {
        onPhase({ type: "error", message: message.message });
        return;
      }

      onPhase({
        type: "done",
        url: finalImageUrl(cloudfrontDomain, message.key),
      });
    } catch (error) {
      fail(error);
    } finally {
      releaseSocket(run.socket);
    }
  }

  return {
    cancel() {
      if (run.settled) return;
      run.cancelled = true;
      run.settled = true;
      clearTimer();
      if (run.socket) {
        releaseSocket(run.socket);
        return;
      }
      void sessionPromise.then((ws) => ws.close()).catch(() => undefined);
    },
  };
}
