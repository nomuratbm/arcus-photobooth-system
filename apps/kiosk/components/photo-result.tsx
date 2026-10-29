"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const RESULT_SECONDS = 30;

const exitClassName = "rounded-full bg-paper px-8 py-3 font-medium text-ink";

export function PhotoResult({ url }: { url: string }) {
  const router = useRouter();
  const routerRef = useRef(router);
  const [seconds, setSeconds] = useState(RESULT_SECONDS);

  // Keep the latest router for the countdown callback without re-running the
  // timer effect (refs must not be written during render).
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    let remaining = RESULT_SECONDS;
    const timer = window.setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        setSeconds(remaining);
        return;
      }
      window.clearInterval(timer);
      routerRef.current.push("/");
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col items-center gap-6 px-6 py-8">
      <p
        aria-live="polite"
        className="sticky top-4 z-10 rounded-full bg-ink/85 px-6 py-3 text-center backdrop-blur"
      >
        <span className="font-display text-5xl tabular-nums">{seconds}</span>
        <span className="mt-1 block text-sm text-paper/70">seconds</span>
      </p>
      {/* Tall, scrollable frame: the strip is portrait, so size it by height
          (well beyond one viewport) instead of letterboxing it into one screen. */}
      <div className="relative aspect-[600/1697] h-[170dvh] max-w-[92vw] overflow-hidden rounded-[2rem] border-[12px] border-paper bg-black">
        <Image
          src={url}
          alt="Finished photobooth photo in its frame"
          fill
          unoptimized
          sizes="min(92vw, 61dvh)"
          className="object-contain"
        />
      </div>
      <Link href="/" className={exitClassName}>
        Exit
      </Link>
    </div>
  );
}

export function BoothNotice({
  message,
  action,
  onAction,
}: {
  message: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/75 px-8 text-center">
      <p className="max-w-sm text-lg">{message}</p>
      <button
        type="button"
        onClick={onAction}
        className="rounded-full bg-paper px-5 py-2 font-medium text-ink"
      >
        {action}
      </button>
    </div>
  );
}
