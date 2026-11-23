import { NextResponse } from "next/server";
import { handle, HttpError, readJson, requireCourseOwner, text } from "@/lib/auth";
import { createTopic } from "@/lib/db";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  return handle(async () => {
    const { id } = await params;
    await requireCourseOwner(id);
    const body = await readJson(request);
    const title = text(body.title, 100);
    if (!title) throw new HttpError(400, "Kapittelet trenger en tittel.");
    const topic = createTopic(id, title, text(body.description, 1200));
    return NextResponse.json({ topic }, { status: 201 });
  });
}
