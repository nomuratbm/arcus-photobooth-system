export function CountdownOverlay({ seconds }: { seconds: number }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/45">
      <p className="font-display text-[7rem] leading-none text-white">{seconds}</p>
    </div>
  );
}
