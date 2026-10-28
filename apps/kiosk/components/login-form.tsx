import Link from "next/link";
import { loginAdmin } from "@/lib/actions";

export function LoginForm({
  invalid,
  configured,
}: {
  invalid: boolean;
  configured: boolean;
}) {
  return (
    <form action={loginAdmin} className="w-full max-w-sm space-y-5">
      <div>
        <p className="text-sm tracking-[0.2em] text-paper/70 uppercase">ARCUS</p>
        <h1 className="font-display text-4xl">Staff print desk</h1>
      </div>
      {configured ? null : (
        <p className="text-sm text-amber">Set ADMIN_PASSWORD before signing in.</p>
      )}
      {invalid ? <p className="text-sm text-amber">That password is not correct.</p> : null}
      <label className="block space-y-2 text-sm">
        <span>Password</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="w-full rounded-2xl border border-paper/20 bg-black/30 px-4 py-3 text-base outline-none focus:border-amber"
        />
      </label>
      <button
        type="submit"
        className="w-full rounded-full bg-amber px-4 py-3 font-medium text-ink"
      >
        Enter
      </button>
      <Link
        href="/camera"
        className="block text-center text-sm text-paper/80 underline-offset-4 hover:underline"
      >
        Back to camera
      </Link>
    </form>
  );
}
