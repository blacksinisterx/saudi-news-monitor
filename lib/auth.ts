// Single-user cookie session. HMAC-signed expiry, Web Crypto only (works in middleware + route handlers).
export const COOKIE = "sm_session";
const DAYS = 90;
const enc = new TextEncoder();

async function hmac(data: string): Promise<string> {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) throw new Error("SESSION_SECRET must be set (16+ chars)");
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function makeSession(): Promise<{ value: string; maxAge: number }> {
  const exp = Date.now() + DAYS * 86400_000;
  return { value: `${exp}.${await hmac(String(exp))}`, maxAge: DAYS * 86400 };
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function validSession(value?: string): Promise<boolean> {
  if (!value) return false;
  const [exp, sig] = value.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(sig, await hmac(exp));
}

export async function passwordOk(input: string): Promise<boolean> {
  const real = process.env.APP_PASSWORD;
  if (!real) return false;
  // compare hashes so length differences don't leak through the comparison
  const h = async (s: string) => hmac(`pw:${s}`);
  return safeEqual(await h(input), await h(real));
}
