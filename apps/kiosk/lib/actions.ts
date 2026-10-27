"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  SESSION_COOKIE,
  adminCookieOptions,
  adminSessionToken,
  passwordsMatch,
  verifyAdminSession,
} from "@/lib/auth";

export async function loginAdmin(formData: FormData): Promise<void> {
  const password = String(formData.get("password") ?? "");
  const expected = process.env.ADMIN_PASSWORD;

  if (!expected || !passwordsMatch(password, expected)) {
    redirect("/print?error=1");
  }

  const jar = await cookies();
  jar.set(SESSION_COOKIE, adminSessionToken(expected), adminCookieOptions());
  redirect("/print");
}

export async function logoutAdmin(): Promise<void> {
  const session = await verifyAdminSession();
  if (session) {
    const jar = await cookies();
    jar.delete(SESSION_COOKIE);
  }
  redirect("/print");
}
