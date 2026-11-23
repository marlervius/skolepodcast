import type { Metadata } from "next";
import Link from "next/link";
import { CourseViewClient } from "@/components/CourseViewClient";
import { getCourseByCode } from "@/lib/db";
import { normalizeCode } from "@/lib/types";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ code: string }> };

function load(code: string) {
  const normalized = normalizeCode(decodeURIComponent(code));
  return normalized ? getCourseByCode(normalized) : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const course = load((await params).code);
  return course ? { title: course.title, description: course.description || `${course.subject} med ${course.teacher_name}` } : { title: "Fant ikke fagrommet" };
}

export default async function CoursePage({ params }: Props) {
  const course = load((await params).code);
  if (!course) {
    return (
      <div className="page">
        <div className="empty empty--page">
          <h1>Fant ikke fagrommet</h1>
          <p>Klassekoden finnes ikke, eller læreren har slettet fagrommet. Sjekk at koden er skrevet riktig.</p>
          <Link className="button button--primary" href="/">Til Mine fag</Link>
        </div>
      </div>
    );
  }
  return <CourseViewClient course={course} />;
}
