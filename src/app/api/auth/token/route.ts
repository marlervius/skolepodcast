import { NextResponse } from "next/server";
import {
  clientIp, createSessionToken, currentTeacher, handle, HttpError, limitAttempts, readJson, text,
} from "@/lib/auth";
import { findTeacherByEmail } from "@/lib/db";
import { MAX_UPLOAD_MB } from "@/lib/limits";
import { verifyPassword } from "@/lib/password";

/**
 * Utsteder en signert tilkoblingsnøkkel for Chrome-utvidelsen til NotebookLM.
 * Kan kalles enten av en allerede innlogget lærer i studioet, eller med e-post og passord fra utvidelsen.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const existing = await currentTeacher();
    const body = await readJson(request).catch(() => ({} as Record<string, unknown>));
    const email = text(body.email, 160).toLowerCase();
    const password = typeof body.password === "string" ? body.password.slice(0, 200) : "";

    if (email || password) {
      limitAttempts(`token-ip:${clientIp(request)}`, 30, 15 * 60_000);
      limitAttempts(`token:${email}`, 10, 15 * 60_000);
      const found = email ? await findTeacherByEmail(email) : null;
      if (!found || !verifyPassword(password, found.password_hash)) {
        throw new HttpError(401, "Feil e-post eller passord.");
      }
      const teacher = { id: found.id, name: found.name, email: found.email, created_at: found.created_at };
      return NextResponse.json({
        teacher,
        token: createSessionToken(teacher.id),
        max_upload_mb: MAX_UPLOAD_MB,
      });
    }

    if (!existing) throw new HttpError(401, "Du må logge inn for å lage en tilkoblingsnøkkel.");
    return NextResponse.json({
      teacher: existing,
      token: createSessionToken(existing.id),
      max_upload_mb: MAX_UPLOAD_MB,
    });
  });
}
