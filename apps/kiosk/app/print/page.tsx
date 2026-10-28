import Link from "next/link";
import { logoutAdmin } from "@/lib/actions";
import { verifyAdminSession } from "@/lib/auth";
import type { PrintPhoto } from "@/lib/contracts";
import { listFinalPhotos, PrintStorageError } from "@/lib/s3";
import { LoginForm } from "@/components/login-form";
import { PhotoGrid } from "@/components/photo-grid";
import { PrintButton } from "@/components/print-button";

export const dynamic = "force-dynamic";

export default async function PrintPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sessionPromise = verifyAdminSession();
  const paramsPromise = searchParams;
  const [isAdmin, params] = await Promise.all([sessionPromise, paramsPromise]);

  if (!isAdmin) {
    return (
      <main className="grid min-h-dvh place-items-center px-6">
        <LoginForm
          invalid={params.error === "1"}
          configured={Boolean(process.env.ADMIN_PASSWORD)}
        />
      </main>
    );
  }

  let photos: PrintPhoto[] = [];
  let listError: string | null = null;
  try {
    photos = await listFinalPhotos();
  } catch (error) {
    listError =
      error instanceof PrintStorageError
        ? error.message
        : "Could not load photos from storage.";
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-6 px-6 py-8">
      <header className="no-print flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm tracking-[0.2em] text-paper/70 uppercase">ARCUS</p>
          <h1 className="font-display text-4xl">Print desk</h1>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/camera" className="text-sm text-paper/80 underline-offset-4 hover:underline">
            Back to booth
          </Link>
          <PrintButton />
          <form action={logoutAdmin}>
            <button
              type="submit"
              className="rounded-full border border-paper/30 px-4 py-2 text-sm"
            >
              Log out
            </button>
          </form>
        </div>
      </header>
      {listError !== null ? (
        <p className="text-lg">{listError}</p>
      ) : (
        <PhotoGrid photos={photos} />
      )}
    </main>
  );
}
