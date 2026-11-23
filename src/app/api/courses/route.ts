import { NextResponse } from "next/server";
import { handle, HttpError, readJson, requireTeacher, text } from "@/lib/auth";
import { createCourse, getCourseSummariesByCodes, getCourseSummaryByCode, isCodeTaken, listTeacherCourses } from "@/lib/db";
import { DEFAULT_COLOR, isCourseColor, normalizeCode } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handle(async () => {
    const params = new URL(request.url).searchParams;
    if (params.has("code")) {
      const code = normalizeCode(params.get("code"));
      const course = code ? getCourseSummaryByCode(code) : null;
      if (!course) throw new HttpError(404, "Fant ikke noe fagrom med denne klassekoden.");
      return NextResponse.json({ course });
    }
    if (params.has("codes")) {
      const codes = [...new Set((params.get("codes") || "").split(",").map(normalizeCode).filter(Boolean))].slice(0, 50);
      return NextResponse.json({ courses: getCourseSummariesByCodes(codes) });
    }
    if (params.get("mine") === "1") {
      const teacher = await requireTeacher();
      return NextResponse.json({ courses: listTeacherCourses(teacher.id) });
    }
    throw new HttpError(400, "Oppgi code, codes eller mine=1.");
  });
}

/** Lager en lesbar kode, f.eks. HIST-VG3, og legger på et tall hvis den er tatt. */
function generateCode(subject: string, classLabel: string) {
  const base = normalizeCode(`${subject.replace(/\s+/g, "").slice(0, 4)}-${classLabel}`) || "FAG";
  if (!isCodeTaken(base)) return base;
  for (let attempt = 2; attempt < 1000; attempt++) {
    const candidate = `${base}-${attempt}`.slice(0, 32);
    if (!isCodeTaken(candidate)) return candidate;
  }
  return `${base}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export async function POST(request: Request) {
  return handle(async () => {
    const teacher = await requireTeacher();
    const body = await readJson(request);
    const title = text(body.title, 100);
    const subject = text(body.subject, 80);
    if (!title) throw new HttpError(400, "Fagrommet trenger en tittel.");
    if (!subject) throw new HttpError(400, "Skriv inn hvilket fag dette gjelder.");
    const classLabel = text(body.class_label, 40);
    let code = normalizeCode(body.code);
    if (code) {
      if (code.length < 3) throw new HttpError(400, "Klassekoden må ha minst 3 tegn.");
      if (isCodeTaken(code)) throw new HttpError(409, "Klassekoden er allerede i bruk. Velg en annen.");
    } else {
      code = generateCode(subject, classLabel);
    }
    const course = createCourse(teacher.id, {
      title,
      subject,
      class_label: classLabel,
      description: text(body.description, 1200),
      code,
      accent_color: isCourseColor(body.accent_color) ? String(body.accent_color) : DEFAULT_COLOR,
    }, "Kapittel 1");
    return NextResponse.json({ course }, { status: 201 });
  });
}
