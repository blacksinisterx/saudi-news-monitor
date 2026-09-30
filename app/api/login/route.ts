import { NextResponse } from "next/server";
import { COOKIE, makeSession, passwordOk } from "@/lib/auth";

export async function POST(req: Request) {
  const form = await req.formData();
  const pw = String(form.get("password") ?? "").slice(0, 200);
  const url = new URL("/", req.url);
  if (!(await passwordOk(pw))) return NextResponse.redirect(new URL("/login?error=1", req.url), 303);
  const s = await makeSession();
  const res = NextResponse.redirect(url, 303);
  res.cookies.set(COOKIE, s.value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: s.maxAge });
  return res;
}
