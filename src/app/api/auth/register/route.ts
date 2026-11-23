import { NextResponse } from "next/server";
import { handle, HttpError, readJson, setSessionCookie, text } from "@/lib/auth";
import { createTeacher, findTeacherByEmail } from "@/lib/db";
import { hashPassword } from "@/lib/password";

export async function POST(request: Request) {
  return handle(async () => {
    const body = await readJson(request);
    const name = text(body.name, 80);
    const email = text(body.email, 160).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    if (name.length < 2) throw new HttpError(400, "Skriv inn navnet ditt.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Skriv inn en gyldig e-postadresse.");
    if (password.length < 8) throw new HttpError(400, "Passordet må ha minst 8 tegn.");
    if (password.length > 200) throw new HttpError(400, "Passordet er for langt.");
    if (findTeacherByEmail(email)) throw new HttpError(409, "Det finnes allerede en konto med denne e-postadressen.");
    const teacher = createTeacher(name, email, hashPassword(password));
    return setSessionCookie(NextResponse.json({ teacher }, { status: 201 }), teacher.id);
  });
}
