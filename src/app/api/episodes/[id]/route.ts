import { NextResponse } from "next/server";
import { handle, HttpError, readJson, requireCourseOwner, text } from "@/lib/auth";
import { deleteEpisode, getEpisode, getTopic, moveEpisode, updateEpisode } from "@/lib/db";
import { deleteMedia } from "@/lib/storage";
import type { Episode } from "@/lib/types";

type Context = { params: Promise<{ id: string }> };

async function ownedEpisode(id: string) {
  const episode = await getEpisode(id);
  if (!episode) throw new HttpError(404, "Fant ikke episoden.");
  await requireCourseOwner(episode.course_id);
  return episode;
}

export async function PATCH(request: Request, { params }: Context) {
  return handle(async () => {
    const { id } = await params;
    const episode = await ownedEpisode(id);
    const body = await readJson(request);
    if (body.move === "up" || body.move === "down") await moveEpisode(id, body.move);
    const input: Partial<Pick<Episode, "title" | "description" | "study_notes" | "topic_id">> = {};
    if (body.title !== undefined) {
      input.title = text(body.title, 140);
      if (!input.title) throw new HttpError(400, "Episoden trenger en tittel.");
    }
    if (body.description !== undefined) input.description = text(body.description, 1600);
    if (body.study_notes !== undefined) input.study_notes = text(body.study_notes, 8000);
    if (body.topic_id !== undefined) {
      const topic = await getTopic(text(body.topic_id, 64));
      if (!topic || topic.course_id !== episode.course_id) throw new HttpError(400, "Kapittelet hører ikke til dette fagrommet.");
      input.topic_id = topic.id;
    }
    return NextResponse.json({ episode: await updateEpisode(id, input) });
  });
}

export async function DELETE(_request: Request, { params }: Context) {
  return handle(async () => {
    const { id } = await params;
    await ownedEpisode(id);
    await deleteMedia(await deleteEpisode(id));
    return new NextResponse(null, { status: 204 });
  });
}
