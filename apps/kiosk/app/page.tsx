import Link from "next/link";

const staffLink = (
  <Link
    href="/print"
    className="absolute top-6 right-6 text-sm text-paper/70 underline-offset-4 hover:underline"
  >
    Staff
  </Link>
);

const title = (
  <h1 className="font-display text-5xl tracking-wide sm:text-6xl">ARCUS PHOTOBOOTH</h1>
);

const proceedLink = (
  <Link href="/frame" className="rounded-full bg-amber px-8 py-3 font-medium text-ink">
    Proceed
  </Link>
);

export default function HomePage() {
  return (
    <main className="relative grid min-h-dvh place-items-center px-6">
      {staffLink}
      <div className="flex flex-col items-center gap-8 text-center">
        {title}
        {proceedLink}
      </div>
    </main>
  );
}
