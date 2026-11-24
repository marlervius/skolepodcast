import { NextResponse } from "next/server";
import { handle, HttpError, readJson, requireCourseOwner, text } from "@/lib/auth";
import { createEpisode, getTopic } from "@/lib/db";
import { confirmUpload, discardUpload } from "@/lib/storage";
import { parseEmbedUrl } from "@/lib/types";

async function checkTarget(courseId: string, topicId: string) {
  if (!courseId || !topicId) throw new HttpError(400, "Velg fagrom og kapittel.");
  const teacher = await requireCourseOwner(courseId);
  const topic = await getTopic(topicId);
  if (!topic || topic.course_id !== courseId) throw new HttpError(400, "Kapittelet hører ikke til dette fagrommet.");
  return teacher;
}

function details(source: Record<string, unknown>) {
  const title = text(source.title, 140);
  if (!title) throw new HttpError(400, "Episoden trenger en tittel.");
  return { title, description: text(source.description, 1600), study_notes: text(source.study_notes, 8000) };
}

/**
 * Lager en episode. Enten fra en fil læreren allerede har lastet opp via /api/uploads
 * (upload_path), eller fra en YouTube- eller Vimeo-lenke (embed_url).
 */
export async function POST(request: Request) {
  return handle(async () => {
    const body = await readJson(request);
    const courseId = text(body.course_id, 64);
    const topicId = text(body.topic_id, 64);
    const uploadPath = text(body.upload_path, 200);

    let teacher;
    try {
      teacher = await checkTarget(courseId, topicId);
    } catch (error) {
      if (uploadPath) await discardUpload(uploadPath).catch(() => undefined);
      throw error;
    }
    const info = details(body);

    if (uploadPath) {
      const saved = await confirmUpload(teacher.id, uploadPath);
      try {
        const duration = Math.max(0, Math.min(86_400, Math.round(Number(body.duration_seconds) || 0)));
        const episode = await createEpisode({ ...info, ...saved, course_id: courseId, topic_id: topicId, embed_url: "", duration_seconds: duration });
        return NextResponse.json({ episode }, { status: 201 });
      } catch (error) {
        await discardUpload(uploadPath).catch(() => undefined);
        throw error;
      }
    }

    const embed = parseEmbedUrl(text(body.embed_url, 500));
    if (!embed) throw new HttpError(400, "Lim inn en gyldig lenke til YouTube eller Vimeo.");
    const episode = await createEpisode({ ...info, course_id: courseId, topic_id: topicId, media_type: "embed", media_url: embed, embed_url: embed, duration_seconds: 0 });
    return NextResponse.json({ episode }, { status: 201 });
  });
}
