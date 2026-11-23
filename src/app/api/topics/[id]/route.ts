import { NextResponse } from "next/server";
import { handle, HttpError, readJson, requireCourseOwner, text } from "@/lib/auth";
import { deleteTopic, getTopic, moveTopic, updateTopic } from "@/lib/db";
import { deleteMediaFiles } from "@/lib/storage";

type Context = { params: Promise<{ id: string }> };

async function ownedTopic(id: string) {
  const topic = getTopic(id);
  if (!topic) throw new HttpError(404, "Fant ikke kapittelet.");
  await requireCourseOwner(topic.course_id);
  return topic;
}

export async function PATCH(request: Request, { params }: Context) {
  return handle(async () => {
    const { id } = await params;
    await ownedTopic(id);
    const body = await readJson(request);
    if (body.move === "up" || body.move === "down") moveTopic(id, body.move);
    const input: { title?: string; description?: string } = {};
    if (body.title !== undefined) {
      input.title = text(body.title, 100);
      if (!input.title) throw new HttpError(400, "Kapittelet trenger en tittel.");
    }
    if (body.description !== undefined) input.description = text(body.description, 1200);
    return NextResponse.json({ topic: updateTopic(id, input) });
  });
}

export async function DELETE(_request: Request, { params }: Context) {
  return handle(async () => {
    const { id } = await params;
    await ownedTopic(id);
    await deleteMediaFiles(deleteTopic(id));
    return new NextResponse(null, { status: 204 });
  });
}
