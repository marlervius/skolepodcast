import { NextResponse } from "next/server";
import { currentTeacher, handle, HttpError, readJson, requireCourseOwner, text } from "@/lib/auth";
import { deleteEpisode, getEpisode, getTopic, moveEpisode, updateEpisode, type EpisodeUpdate } from "@/lib/db";
import { confirmUpload, deleteMedia, discardUpload } from "@/lib/storage";
import { publicMediaPrefix } from "@/lib/supabase";
import { parseEmbedUrl } from "@/lib/types";

type Context = { params: Promise<{ id: string }> };

async function ownedEpisode(id: string) {
  const episode = await getEpisode(id);
  if (!episode) throw new HttpError(404, "Fant ikke episoden.");
  const teacher = await requireCourseOwner(episode.course_id);
  return { episode, teacher };
}

/**
 * Endrer en episode. Med upload_path (en fil lastet opp via /api/uploads) eller embed_url
 * byttes lyden/videoen ut, mens episoden beholder id-en sin, så elevenes fremdrift blir stående.
 */
export async function PATCH(request: Request, { params }: Context) {
  return handle(async () => {
    const { id } = await params;
    const body = await readJson(request);
    let uploadPath = text(body.upload_path, 200);

    let owned;
    try {
      owned = await ownedEpisode(id);
    } catch (error) {
      // Rydd bort filen bare hvis den ligger i den innloggede lærerens egen mappe.
      const owner = uploadPath ? await currentTeacher().catch(() => null) : null;
      if (owner) await discardUpload(owner.id, uploadPath).catch(() => undefined);
      throw error;
    }
    const { episode, teacher } = owned;
    // Samme fil som episoden allerede bruker: ingen bytte, og den må aldri ryddes bort.
    if (uploadPath && episode.media_url === publicMediaPrefix() + uploadPath) uploadPath = "";

    let updated;
    try {
      const input: EpisodeUpdate = {};
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

      if (uploadPath) {
        const saved = await confirmUpload(teacher.id, uploadPath);
        const duration = Math.max(0, Math.min(86_400, Math.round(Number(body.duration_seconds) || 0)));
        Object.assign(input, { ...saved, embed_url: "", duration_seconds: duration });
      } else if (body.embed_url !== undefined) {
        const embed = parseEmbedUrl(text(body.embed_url, 500));
        if (!embed) throw new HttpError(400, "Lim inn en gyldig lenke til YouTube eller Vimeo.");
        Object.assign(input, { media_type: "embed", media_url: embed, embed_url: embed, duration_seconds: 0 });
      }

      if (body.move === "up" || body.move === "down") await moveEpisode(id, body.move);
      updated = await updateEpisode(id, input);
    } catch (error) {
      if (uploadPath) await discardUpload(teacher.id, uploadPath).catch(() => undefined);
      throw error;
    }

    // Den gamle filen slettes først når episoden peker på den nye.
    if (updated.media_url !== episode.media_url) {
      await deleteMedia(episode.media_url).catch((error) => console.error("Kunne ikke slette gammel mediefil:", error));
    }
    return NextResponse.json({ episode: updated });
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
