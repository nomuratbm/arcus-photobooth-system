import { captureJpeg } from "@/lib/capture";
import { finalImageUrl, SHOT_COUNT } from "@/lib/contracts";
import { openManagedSession, type ManagedSession } from "@/lib/socket";
import { requestPresign, uploadJpeg } from "@/lib/upload";

export const COUNTDOWN_SECONDS = 5;

/**
 * The Bedrock background-removal model allows 1 request per minute. Within a
 * session the three shots still run back-to-back (5s countdown each); the
 * cooldown only gates the START of the next session, measured from the last
 * uploaded shot, so consecutive sessions don't stack up invocations.
 */
export const SESSION_COOLDOWN_SECONDS = 60;

const LAST_SHOT_KEY = "arcus.lastShotAt";

function lastShotAt(): number {
  const raw = Number(window.localStorage.getItem(LAST_SHOT_KEY));
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function markShotNow() {
  window.localStorage.setItem(LAST_SHOT_KEY, String(Date.now()));
}

/**
 * Seconds left before the next session may start without hitting the 1/min
 * rate limit. Persisted in localStorage so reloads and fresh sessions on the
 * same kiosk honour the previous shot's cooldown.
 */
export function secondsUntilNextSessionAllowed(): number {
  const elapsed = (Date.now() - lastShotAt()) / 1000;
  return Math.max(0, Math.ceil(SESSION_COOLDOWN_SECONDS - elapsed));
}

export type GuestPhase =
  | { type: "idle" }
  | { type: "cooldown"; seconds: number; shot: number }
  | { type: "countdown"; seconds: number; shot: number }
  | { type: "uploading"; shot: number }
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
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Photo processing failed.";
}

/**
 * Owns one guest session: captures SHOT_COUNT photos, each preceded by its own
 * countdown, uploads each as it is taken, then waits for the single composited
 * strip. The booth only renders phases.
 *
 * The connection is managed by {@link openManagedSession}, which reconnects
 * automatically if the socket drops mid-session so the guest isn't stuck.
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

  const sessionId = crypto.randomUUID();
  const run: Run = { cancelled: false, settled: false };

  // The result timeout caps the WHOLE session, so it must also cover the
  // possible pre-session cooldown and the per-shot countdowns.
  const resultTimeoutMs =
    90_000 + (SESSION_COOLDOWN_SECONDS + SHOT_COUNT * COUNTDOWN_SECONDS) * 1000;

  const session: ManagedSession = openManagedSession(
    wsUrl,
    {
      photoId: sessionId,
      eventId,
      bgId,
      frameId,
    },
    { resultTimeoutMs },
  );

  // Interruptible 1s tick used by the countdowns.
  let tickTimer: number | null = null;
  let tickResolve: (() => void) | null = null;
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      tickResolve = resolve;
      tickTimer = window.setTimeout(() => {
        tickTimer = null;
        tickResolve = null;
        resolve();
      }, ms);
    });
  const interruptSleep = () => {
    if (tickTimer !== null) {
      window.clearTimeout(tickTimer);
      tickTimer = null;
    }
    const resolve = tickResolve;
    tickResolve = null;
    resolve?.();
  };

  const fail = (error: unknown) => {
    if (run.cancelled || run.settled) return;
    run.settled = true;
    interruptSleep();
    onPhase({ type: "error", message: errorMessage(error) });
    session.close();
  };

  // A connection that fails (after its reconnects are exhausted) should surface
  // immediately rather than leave the guest waiting.
  session.connected.catch(() => undefined);
  session.result.catch((error: unknown) => {
    fail(error);
  });

  async function runSession() {
    const indices = Array.from({ length: SHOT_COUNT }, (_, i) => i + 1);

    try {
      // Ensure the backend has the connection registered before any upload
      // can kick off processing.
      await session.connected;
    } catch (error) {
      fail(error);
      return;
    }
    if (run.cancelled || run.settled) return;

    for (const shot of indices) {
      // Before the first shot only, wait out any leftover cooldown from the
      // previous session; within a session the shots run back-to-back.
      if (shot === 1) {
        let remaining = secondsUntilNextSessionAllowed();
        while (remaining > 0) {
          if (run.cancelled || run.settled) return;
          onPhase({ type: "cooldown", seconds: remaining, shot });
          await sleep(1000);
          remaining = secondsUntilNextSessionAllowed();
        }
        if (run.cancelled || run.settled) return;
      }

      // Countdown for this shot.
      for (let seconds = COUNTDOWN_SECONDS; seconds > 0; seconds--) {
        if (run.cancelled || run.settled) return;
        onPhase({ type: "countdown", seconds, shot });
        await sleep(1000);
      }
      if (run.cancelled || run.settled) return;

      // Capture and upload this shot immediately so processing can start.
      onPhase({ type: "uploading", shot });
      try {
        const uploadUrl = await requestPresign(sessionId, shot);
        const blob = await captureJpeg(video);
        if (run.cancelled || run.settled) return;
        await uploadJpeg(uploadUrl, blob);
        markShotNow();
      } catch (error) {
        fail(error);
        return;
      }
      if (run.cancelled || run.settled) return;
    }

    // All shots uploaded; wait for the composited strip.
    onPhase({ type: "processing" });
    try {
      const message = await session.result;
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
      return;
    } finally {
      session.close();
    }
  }

  void runSession();

  return {
    cancel() {
      if (run.settled) return;
      run.cancelled = true;
      run.settled = true;
      interruptSleep();
      session.close();
    },
  };
}
