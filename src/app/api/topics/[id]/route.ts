import { NextResponse } from "next/server";
import { handle, HttpError, readJson, requireCourseOwner, text } from "@/lib/auth";
import { deleteTopic, getTopic, moveTopic, updateTopic } from "@/lib/db";
import { parseNotebookUrl } from "@/lib/notebooklm";
import { deleteMediaFiles } from "@/lib/storage";

type Context = { params: Promise<{ id: string }> };

async function ownedTopic(id: string) {
  const topic = await getTopic(id);
  if (!topic) throw new HttpError(404, "Fant ikke kapittelet.");
  await requireCourseOwner(topic.course_id);
  return topic;
}

export async function PATCH(request: Request, { params }: Context) {
  return handle(async () => {
    const { id } = await params;
    await ownedTopic(id);
    const body = await readJson(request);
    if (body.move === "up" || body.move === "down") await moveTopic(id, body.move);
    const input: { title?: string; description?: string; notebook_url?: string } = {};
    if (body.title !== undefined) {
      input.title = text(body.title, 100);
      if (!input.title) throw new HttpError(400, "Kapittelet trenger en tittel.");
    }
    if (body.description !== undefined) input.description = text(body.description, 1200);
    if (body.notebook_url !== undefined) {
      const notebookUrl = parseNotebookUrl(body.notebook_url);
      if (notebookUrl === null) throw new HttpError(400, "Lim inn en gyldig lenke til NotebookLM (notebooklm.google.com).");
      input.notebook_url = notebookUrl;
    }
    return NextResponse.json({ topic: await updateTopic(id, input) });
  });
}

export async function DELETE(_request: Request, { params }: Context) {
  return handle(async () => {
    const { id } = await params;
    await ownedTopic(id);
    await deleteMediaFiles(await deleteTopic(id));
    return new NextResponse(null, { status: 204 });
  });
}
