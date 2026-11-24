import { NextResponse } from "next/server";
import { handle, HttpError, readJson, requireCourseOwner, text } from "@/lib/auth";
import { createUpload } from "@/lib/storage";

/** Gir læreren en tidsbegrenset lenke for å laste opp én fil direkte til Supabase Storage. */
export async function POST(request: Request) {
  return handle(async () => {
    const body = await readJson(request);
    const courseId = text(body.course_id, 64);
    if (!courseId) throw new HttpError(400, "Velg fagrom.");
    const teacher = await requireCourseOwner(courseId);
    const upload = await createUpload(teacher.id, text(body.filename, 255), Number(body.size));
    return NextResponse.json(upload, { status: 201 });
  });
}
