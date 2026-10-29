import { SHOT_COUNT } from "@/lib/contracts";

export function CountdownOverlay({ seconds, shot }: { seconds: number; shot: number }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/45">
      <p className="text-sm tracking-[0.3em] text-white/80 uppercase">
        Shot {shot} of {SHOT_COUNT}
      </p>
      <p className="font-display text-[7rem] leading-none text-white">{seconds}</p>
    </div>
  );
}
