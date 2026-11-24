import { NextResponse } from "next/server";
import { handle, HttpError, readJson, setSessionCookie, text } from "@/lib/auth";
import { findTeacherByEmail } from "@/lib/db";
import { verifyPassword } from "@/lib/password";

export async function POST(request: Request) {
  return handle(async () => {
    const body = await readJson(request);
    const email = text(body.email, 160).toLowerCase();
    const password = typeof body.password === "string" ? body.password.slice(0, 200) : "";
    const found = email ? await findTeacherByEmail(email) : null;
    if (!found || !verifyPassword(password, found.password_hash)) {
      throw new HttpError(401, "Feil e-post eller passord.");
    }
    const teacher = { id: found.id, name: found.name, email: found.email, created_at: found.created_at };
    return setSessionCookie(NextResponse.json({ teacher }), teacher.id);
  });
}
