import type { Metadata } from "next";
import Link from "next/link";
import { CachedCourseView, CourseViewClient } from "@/components/CourseViewClient";
import { getCourseByCode } from "@/lib/db";
import { normalizeCode, toPublicCourse, type Course } from "@/lib/types";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ code: string }> };

type LoadResult =
  | { status: "found"; course: Course }
  | { status: "not_found" }
  | { status: "offline"; code: string };

async function load(rawCode: string): Promise<LoadResult> {
  const normalized = normalizeCode(decodeURIComponent(rawCode));
  if (!normalized) return { status: "not_found" };
  try {
    const course = await getCourseByCode(normalized);
    return course ? { status: "found", course: toPublicCourse(course) } : { status: "not_found" };
  } catch (error) {
    console.error("[course-page]", error);
    return { status: "offline", code: normalized };
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const result = await load((await params).code);
  if (result.status === "found") {
    const { course } = result;
    return {
      title: course.title,
      description: course.description || `${course.subject} med ${course.teacher_name}`,
    };
  }
  return { title: result.status === "offline" ? "Lytterom" : "Fant ikke fagrommet" };
}

export default async function CoursePage({ params }: Props) {
  const result = await load((await params).code);
  if (result.status === "offline") {
    return <CachedCourseView code={result.code} />;
  }
  if (result.status === "not_found") {
    return (
      <div className="page">
        <div className="empty empty--page">
          <h1>Fant ikke fagrommet</h1>
          <p>Klassekoden finnes ikke, eller læreren har slettet fagrommet. Sjekk at koden er skrevet riktig.</p>
          <Link className="button button--primary" href="/mine-fag">Til Mine fag</Link>
        </div>
      </div>
    );
  }
  return <CourseViewClient course={result.course} />;
}
