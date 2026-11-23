import { NextResponse } from "next/server";
import { handle, HttpError, readJson, requireCourseOwner, text } from "@/lib/auth";
import { deleteCourse, getCourse, isCodeTaken, updateCourse, type CourseInput } from "@/lib/db";
import { deleteMediaFiles } from "@/lib/storage";
import { isCourseColor, normalizeCode } from "@/lib/types";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  return handle(async () => {
    const course = getCourse((await params).id);
    if (!course) throw new HttpError(404, "Fant ikke fagrommet.");
    return NextResponse.json({ course });
  });
}

export async function PATCH(request: Request, { params }: Context) {
  return handle(async () => {
    const { id } = await params;
    await requireCourseOwner(id);
    const body = await readJson(request);
    const input: Partial<CourseInput> = {};
    if (body.title !== undefined) {
      input.title = text(body.title, 100);
      if (!input.title) throw new HttpError(400, "Fagrommet trenger en tittel.");
    }
    if (body.subject !== undefined) {
      input.subject = text(body.subject, 80);
      if (!input.subject) throw new HttpError(400, "Skriv inn hvilket fag dette gjelder.");
    }
    if (body.class_label !== undefined) input.class_label = text(body.class_label, 40);
    if (body.description !== undefined) input.description = text(body.description, 1200);
    if (body.accent_color !== undefined && isCourseColor(body.accent_color)) input.accent_color = String(body.accent_color);
    if (body.code !== undefined) {
      const code = normalizeCode(body.code);
      if (code.length < 3) throw new HttpError(400, "Klassekoden må ha minst 3 tegn.");
      if (isCodeTaken(code, id)) throw new HttpError(409, "Klassekoden er allerede i bruk. Velg en annen.");
      input.code = code;
    }
    return NextResponse.json({ course: updateCourse(id, input) });
  });
}

export async function DELETE(_request: Request, { params }: Context) {
  return handle(async () => {
    const { id } = await params;
    await requireCourseOwner(id);
    await deleteMediaFiles(deleteCourse(id));
    return new NextResponse(null, { status: 204 });
  });
}
