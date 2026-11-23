import { NextResponse } from "next/server";
import { handle, HttpError, readJson, requireCourseOwner, text } from "@/lib/auth";
import { createEpisode, getTopic } from "@/lib/db";
import { deleteMedia, saveUpload } from "@/lib/storage";
import { parseEmbedUrl } from "@/lib/types";

export const maxDuration = 300;

async function checkTarget(courseId: string, topicId: string) {
  if (!courseId || !topicId) throw new HttpError(400, "Velg fagrom og kapittel.");
  await requireCourseOwner(courseId);
  const topic = getTopic(topicId);
  if (!topic || topic.course_id !== courseId) throw new HttpError(400, "Kapittelet hører ikke til dette fagrommet.");
}

function details(source: Record<string, unknown>) {
  const title = text(source.title, 140);
  if (!title) throw new HttpError(400, "Episoden trenger en tittel.");
  return { title, description: text(source.description, 1600), study_notes: text(source.study_notes, 8000) };
}

export async function POST(request: Request) {
  return handle(async () => {
    const type = request.headers.get("content-type") || "";

    if (type.includes("multipart/form-data")) {
      const form = await request.formData().catch(() => { throw new HttpError(400, "Kunne ikke lese opplastingen."); });
      const fields = Object.fromEntries([...form.entries()].filter(([, value]) => typeof value === "string"));
      const courseId = text(fields.course_id, 64);
      const topicId = text(fields.topic_id, 64);
      await checkTarget(courseId, topicId);
      const info = details(fields);
      const file = form.get("file");
      if (!(file instanceof File)) throw new HttpError(400, "Velg en lyd- eller videofil.");
      const saved = await saveUpload(file);
      try {
        const duration = Math.max(0, Math.min(86_400, Math.round(Number(fields.duration_seconds) || 0)));
        const episode = createEpisode({ ...info, ...saved, course_id: courseId, topic_id: topicId, embed_url: "", duration_seconds: duration });
        return NextResponse.json({ episode }, { status: 201 });
      } catch (error) {
        await deleteMedia(saved.media_url);
        throw error;
      }
    }

    const body = await readJson(request);
    const courseId = text(body.course_id, 64);
    const topicId = text(body.topic_id, 64);
    await checkTarget(courseId, topicId);
    const info = details(body);
    const embed = parseEmbedUrl(text(body.embed_url, 500));
    if (!embed) throw new HttpError(400, "Lim inn en gyldig lenke til YouTube eller Vimeo.");
    const episode = createEpisode({ ...info, course_id: courseId, topic_id: topicId, media_type: "embed", media_url: embed, embed_url: embed, duration_seconds: 0 });
    return NextResponse.json({ episode }, { status: 201 });
  });
}
