import { NextResponse } from "next/server";
import { handle, HttpError, readJson, requireTeacher, text } from "@/lib/auth";
import {
  createCourse, getCourseByCode, getCourseSummariesByCodes, getCourseSummaryByCode, isCodeTaken,
  listTeacherCourses, listTeacherCoursesWithTopics,
} from "@/lib/db";
import { MAX_UPLOAD_MB } from "@/lib/limits";
import { parseNotebookUrl } from "@/lib/notebooklm";
import { DEFAULT_COLOR, isCourseColor, normalizeCode, type Course, type CourseSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

function stripPrivateFields<T extends CourseSummary>(course: T): T {
  const clean = { ...course };
  delete clean.notebook_url;
  if ("topics" in clean && Array.isArray((clean as unknown as Course).topics)) {
    (clean as unknown as Course).topics = (clean as unknown as Course).topics.map((topic) => {
      const cleanTopic = { ...topic };
      delete cleanTopic.notebook_url;
      return cleanTopic;
    });
  }
  return clean;
}

export async function GET(request: Request) {
  return handle(async () => {
    const params = new URL(request.url).searchParams;
    if (params.has("code")) {
      const code = normalizeCode(params.get("code"));
      // full=1 tar med kapitler og episoder (samme innhold som elevsiden /fag/KODE viser).
      const course = !code ? null : params.get("full") === "1" ? await getCourseByCode(code) : await getCourseSummaryByCode(code);
      if (!course) throw new HttpError(404, "Fant ikke noe fagrom med denne klassekoden.");
      return NextResponse.json({ course: stripPrivateFields(course) });
    }
    if (params.has("codes")) {
      const codes = [...new Set((params.get("codes") || "").split(",").map(normalizeCode).filter(Boolean))].slice(0, 50);
      const courses = (await getCourseSummariesByCodes(codes)).map(stripPrivateFields);
      return NextResponse.json({ courses });
    }
    if (params.get("mine") === "1") {
      const teacher = await requireTeacher();
      if (params.get("with_topics") === "1") {
        return NextResponse.json({
          courses: await listTeacherCoursesWithTopics(teacher.id),
          max_upload_mb: MAX_UPLOAD_MB,
        });
      }
      return NextResponse.json({ courses: await listTeacherCourses(teacher.id) });
    }
    throw new HttpError(400, "Oppgi code, codes eller mine=1.");
  });
}

/** Lager en lesbar kode, f.eks. HIST-VG3, og legger på et tall hvis den er tatt. */
async function generateCode(subject: string, classLabel: string) {
  const base = normalizeCode(`${subject.replace(/\s+/g, "").slice(0, 4)}-${classLabel}`) || "FAG";
  if (!(await isCodeTaken(base))) return base;
  for (let attempt = 2; attempt < 1000; attempt++) {
    const candidate = `${base}-${attempt}`.slice(0, 32);
    if (!(await isCodeTaken(candidate))) return candidate;
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
      if (await isCodeTaken(code)) throw new HttpError(409, "Klassekoden er allerede i bruk. Velg en annen.");
    } else {
      code = await generateCode(subject, classLabel);
    }
    const notebookUrl = parseNotebookUrl(body.notebook_url);
    if (notebookUrl === null) {
      throw new HttpError(400, "Lim inn en gyldig lenke til NotebookLM (notebooklm.google.com).");
    }
    const course = await createCourse(teacher.id, {
      title,
      subject,
      class_label: classLabel,
      description: text(body.description, 1200),
      code,
      accent_color: isCourseColor(body.accent_color) ? String(body.accent_color) : DEFAULT_COLOR,
      notebook_url: notebookUrl,
    }, "Kapittel 1");
    return NextResponse.json({ course }, { status: 201 });
  });
}
