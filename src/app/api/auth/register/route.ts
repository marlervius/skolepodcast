import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { clientIp, handle, HttpError, limitAttempts, readJson, setSessionCookie, text } from "@/lib/auth";
import { createTeacher, findTeacherByEmail } from "@/lib/db";
import { hashPassword } from "@/lib/password";

export async function POST(request: Request) {
  return handle(async () => {
    const body = await readJson(request);
    const name = text(body.name, 80);
    const email = text(body.email, 160).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    const invite = typeof body.invite === "string" ? body.invite.trim() : "";
    limitAttempts(`register:${clientIp(request)}`, 10, 15 * 60_000);
    if (!registrationAllowed(invite)) throw new HttpError(403, "Feil invitasjonskode.");
    if (name.length < 2) throw new HttpError(400, "Skriv inn navnet ditt.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Skriv inn en gyldig e-postadresse.");
    if (password.length < 8) throw new HttpError(400, "Passordet må ha minst 8 tegn.");
    if (password.length > 200) throw new HttpError(400, "Passordet er for langt.");
    if (await findTeacherByEmail(email)) throw new HttpError(409, "Det finnes allerede en konto med denne e-postadressen.");
    const teacher = await createTeacher(name, email, await hashPassword(password));
    return setSessionCookie(NextResponse.json({ teacher }, { status: 201 }), teacher.id);
  });
}

// I produksjon kan bare lærere med invitasjonskoden (LYTTEROM_INVITE_CODE) opprette konto.
// Uten kode satt er registreringen stengt. Under utvikling er den åpen.
function registrationAllowed(invite: string) {
  const expected = process.env.LYTTEROM_INVITE_CODE?.trim();
  if (!expected) return process.env.NODE_ENV !== "production";
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(invite), digest(expected));
}
