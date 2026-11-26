import { randomUUID } from "node:crypto";
import { HttpError } from "./auth";
import { DEMO_COURSE_ID, DEMO_EMAIL, DEMO_TEACHER_ID, demoCourse, demoEpisodes, demoTopics } from "./demo";
import { check, supabase } from "./supabase";
import type { Course, CourseSummary, Episode, MediaType, Teacher, Topic } from "./types";

function isMissingNotebookColumn(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return (error.code === "42703" || error.code === "PGRST204") && /notebook_url/i.test(error.message ?? "");
}

function throwNotebookMigrationHint(): never {
  throw new HttpError(500, "Databasen må oppdateres for NotebookLM-lenker. Kjør supabase/schema.sql i Supabase SQL Editor.");
}

/*
 * Datalaget. Alt går via Supabase (PostgreSQL) med service role-nøkkelen.
 * Tabellene og visningen course_summaries er definert i supabase/schema.sql.
 */

let seeded: Promise<void> | null = null;

/** Henter klienten og sørger for at eksempelfaget finnes. Seedingen kjøres én gang per serverinstans. */
async function db() {
  const client = supabase();
  seeded ??= seedDemo().catch((error) => {
    seeded = null;
    throw error;
  });
  await seeded;
  return client;
}

/**
 * Legger inn eksempelfaget Historie VG3 hvis det mangler. Demokontoen får et passord-hash
 * som aldri kan stemme, så ingen kan logge inn på den. Elevene ser fortsatt faget.
 */
async function seedDemo() {
  const client = supabase();
  const existing = check(await client.from("teachers").select("id").eq("id", DEMO_TEACHER_ID).maybeSingle());
  if (existing) return;
  const ignore = { onConflict: "id", ignoreDuplicates: true };
  check(await client.from("teachers").upsert({ id: DEMO_TEACHER_ID, name: "Demolærer Historie", email: DEMO_EMAIL, password_hash: "!" }, ignore));
  check(await client.from("courses").upsert({ id: DEMO_COURSE_ID, teacher_id: DEMO_TEACHER_ID, ...demoCourse }, ignore));
  check(await client.from("topics").upsert(demoTopics, ignore));
  check(await client.from("episodes").upsert(demoEpisodes, ignore));
}

/* ---------- Lærere ---------- */

const TEACHER_FIELDS = "id, name, email, created_at";

export async function createTeacher(name: string, email: string, passwordHash: string): Promise<Teacher> {
  const client = await db();
  return check(await client.from("teachers").insert({ id: randomUUID(), name, email, password_hash: passwordHash }).select(TEACHER_FIELDS).single());
}
export async function getTeacher(id: string): Promise<Teacher | null> {
  const client = await db();
  return check(await client.from("teachers").select(TEACHER_FIELDS).eq("id", id).maybeSingle());
}
export async function findTeacherByEmail(email: string): Promise<(Teacher & { password_hash: string }) | null> {
  const client = await db();
  return check(await client.from("teachers").select("*").eq("email", email.toLowerCase()).maybeSingle());
}

/* ---------- Fagrom ---------- */

function summaries() {
  return supabase().from("course_summaries").select("*");
}

export async function listTeacherCourses(teacherId: string): Promise<CourseSummary[]> {
  await db();
  return check(await summaries().eq("teacher_id", teacherId).order("created_at", { ascending: false }));
}

export type TeacherCourseWithTopics = CourseSummary & {
  topics: { id: string; title: string; notebook_url?: string }[];
};

export async function listTeacherCoursesWithTopics(teacherId: string): Promise<TeacherCourseWithTopics[]> {
  const client = await db();
  const courses = await listTeacherCourses(teacherId);
  if (!courses.length) return [];
  const ids = courses.map((course) => course.id);
  const topicsRes = await client.from("topics").select("*").in("course_id", ids).order("sort_order").order("created_at");
  const topicRows: Omit<Topic, "episodes">[] = check(topicsRes);
  return courses.map((course) => ({
    ...course,
    topics: topicRows
      .filter((topic) => topic.course_id === course.id)
      .map((topic) => ({ id: topic.id, title: topic.title, notebook_url: topic.notebook_url ?? "" })),
  }));
}
export async function getCourseSummariesByCodes(codes: string[]): Promise<CourseSummary[]> {
  if (!codes.length) return [];
  await db();
  const order = codes.map((code) => code.toUpperCase());
  const rows: CourseSummary[] = check(await summaries().in("code", order));
  return rows.sort((a, b) => order.indexOf(a.code.toUpperCase()) - order.indexOf(b.code.toUpperCase()));
}
export async function getCourseSummaryByCode(code: string): Promise<CourseSummary | null> {
  await db();
  return check(await summaries().eq("code", code.toUpperCase()).maybeSingle());
}
async function getCourseSummary(id: string): Promise<CourseSummary | null> {
  await db();
  return check(await summaries().eq("id", id).maybeSingle());
}

async function withContent(summary: CourseSummary | null): Promise<Course | null> {
  if (!summary) return null;
  const client = await db();
  const [topics, episodes] = await Promise.all([
    client.from("topics").select("*").eq("course_id", summary.id).order("sort_order").order("created_at"),
    client.from("episodes").select("*").eq("course_id", summary.id).order("sort_order").order("created_at"),
  ]);
  const topicRows: Omit<Topic, "episodes">[] = check(topics);
  const episodeRows: Episode[] = check(episodes);
  return {
    ...summary,
    topics: topicRows.map((topic) => ({ ...topic, episodes: episodeRows.filter((episode) => episode.topic_id === topic.id) })),
  };
}
export async function getCourse(id: string) {
  return withContent(await getCourseSummary(id));
}
export async function getCourseByCode(code: string) {
  return withContent(await getCourseSummaryByCode(code));
}
export async function isCodeTaken(code: string, exceptId = "") {
  const client = await db();
  const rows: { id: string }[] = check(await client.from("courses").select("id").eq("code", code.toUpperCase()).neq("id", exceptId).limit(1));
  return rows.length > 0;
}

export type CourseInput = {
  title: string;
  subject: string;
  class_label: string;
  description: string;
  code: string;
  accent_color: string;
  notebook_url?: string;
};

export async function createCourse(teacherId: string, input: CourseInput, firstTopicTitle: string) {
  const client = await db();
  const id = randomUUID();
  const insertRes = await client.from("courses").insert({ id, teacher_id: teacherId, ...input });
  if (isMissingNotebookColumn(insertRes.error)) {
    if (input.notebook_url) throwNotebookMigrationHint();
    const { notebook_url: _, ...withoutNotebook } = input;
    void _;
    check(await client.from("courses").insert({ id, teacher_id: teacherId, ...withoutNotebook }));
  } else {
    check(insertRes);
  }
  const topic = await client.from("topics").insert({ id: randomUUID(), course_id: id, title: firstTopicTitle, description: "", sort_order: 0 });
  if (topic.error) {
    await client.from("courses").delete().eq("id", id);
    check(topic);
  }
  return (await getCourse(id))!;
}
export async function updateCourse(id: string, input: Partial<CourseInput>) {
  const client = await db();
  const fields = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
  if (Object.keys(fields).length) {
    const updateRes = await client.from("courses").update(fields).eq("id", id);
    if (isMissingNotebookColumn(updateRes.error)) {
      if (input.notebook_url) throwNotebookMigrationHint();
      const { notebook_url: _, ...withoutNotebook } = fields;
      void _;
      if (Object.keys(withoutNotebook).length) check(await client.from("courses").update(withoutNotebook).eq("id", id));
    } else {
      check(updateRes);
    }
  }
  return (await getCourse(id))!;
}
/** Sletter fagrommet og returnerer adressene til opplastede filer som må ryddes bort. */
export async function deleteCourse(id: string) {
  const client = await db();
  const rows: { media_url: string }[] = check(await client.from("episodes").select("media_url").eq("course_id", id));
  check(await client.from("courses").delete().eq("id", id));
  return rows.map((row) => row.media_url);
}
export async function courseOwner(id: string) {
  const client = await db();
  const row: { teacher_id: string } | null = check(await client.from("courses").select("teacher_id").eq("id", id).maybeSingle());
  return row?.teacher_id ?? null;
}

/* ---------- Kapitler ---------- */

async function nextSortOrder(table: "topics" | "episodes", parentColumn: "course_id" | "topic_id", parentId: string) {
  const client = await db();
  const rows: { sort_order: number }[] = check(await client.from(table).select("sort_order").eq(parentColumn, parentId).order("sort_order", { ascending: false }).limit(1));
  return rows.length ? rows[0].sort_order + 1 : 0;
}

export async function createTopic(courseId: string, title: string, description: string, notebookUrl = "") {
  const client = await db();
  const sort_order = await nextSortOrder("topics", "course_id", courseId);
  const baseRow = { id: randomUUID(), course_id: courseId, title, description, sort_order };
  const row = notebookUrl ? { ...baseRow, notebook_url: notebookUrl } : baseRow;
  const insertRes = await client.from("topics").insert(row).select("*").single();
  if (isMissingNotebookColumn(insertRes.error)) {
    if (notebookUrl) throwNotebookMigrationHint();
    return check(await client.from("topics").insert(baseRow).select("*").single()) as Omit<Topic, "episodes">;
  }
  return check(insertRes) as Omit<Topic, "episodes">;
}
export async function getTopic(id: string): Promise<Omit<Topic, "episodes"> | null> {
  const client = await db();
  return check(await client.from("topics").select("*").eq("id", id).maybeSingle());
}
export async function updateTopic(id: string, input: { title?: string; description?: string; notebook_url?: string }) {
  const client = await db();
  const fields = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
  if (Object.keys(fields).length) {
    const updateRes = await client.from("topics").update(fields).eq("id", id);
    if (isMissingNotebookColumn(updateRes.error)) {
      if (input.notebook_url) throwNotebookMigrationHint();
      const { notebook_url: _, ...withoutNotebook } = fields;
      void _;
      if (Object.keys(withoutNotebook).length) check(await client.from("topics").update(withoutNotebook).eq("id", id));
    } else {
      check(updateRes);
    }
  }
  return (await getTopic(id))!;
}
export async function deleteTopic(id: string) {
  const client = await db();
  const rows: { media_url: string }[] = check(await client.from("episodes").select("media_url").eq("topic_id", id));
  check(await client.from("topics").delete().eq("id", id));
  return rows.map((row) => row.media_url);
}

/** Flytter et kapittel eller en episode ett steg opp eller ned blant søsknene. */
async function move(table: "topics" | "episodes", parentColumn: "course_id" | "topic_id", id: string, direction: "up" | "down") {
  const client = await db();
  const item: Record<string, string> | null = check(await client.from(table).select(parentColumn).eq("id", id).maybeSingle());
  if (!item) return;
  const siblings: { id: string }[] = check(await client.from(table).select("id").eq(parentColumn, item[parentColumn]).order("sort_order").order("created_at"));
  const index = siblings.findIndex((sibling) => sibling.id === id);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= siblings.length) return;
  [siblings[index], siblings[target]] = [siblings[target], siblings[index]];
  await Promise.all(siblings.map(async (sibling, order) => check(await client.from(table).update({ sort_order: order }).eq("id", sibling.id))));
}
export async function moveTopic(id: string, direction: "up" | "down") {
  await move("topics", "course_id", id, direction);
}

/* ---------- Episoder ---------- */

export type EpisodeInput = {
  topic_id: string;
  course_id: string;
  title: string;
  description: string;
  study_notes: string;
  media_type: MediaType;
  media_url: string;
  embed_url: string;
  duration_seconds: number;
};

export async function createEpisode(input: EpisodeInput) {
  const client = await db();
  const row = { id: randomUUID(), ...input, sort_order: await nextSortOrder("episodes", "topic_id", input.topic_id) };
  return check(await client.from("episodes").insert(row).select("*").single()) as Episode;
}
export async function getEpisode(id: string): Promise<Episode | null> {
  const client = await db();
  return check(await client.from("episodes").select("*").eq("id", id).maybeSingle());
}
export type EpisodeUpdate = Partial<Pick<Episode,
  "title" | "description" | "study_notes" | "topic_id" | "media_type" | "media_url" | "embed_url" | "duration_seconds">>;

export async function updateEpisode(id: string, input: EpisodeUpdate) {
  const client = await db();
  const { topic_id: topicId, ...rest } = input;
  const fields: Record<string, unknown> = Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined));
  if (topicId !== undefined) {
    const current = await getEpisode(id);
    if (current && current.topic_id !== topicId) {
      fields.topic_id = topicId;
      fields.sort_order = await nextSortOrder("episodes", "topic_id", topicId);
    }
  }
  if (Object.keys(fields).length) check(await client.from("episodes").update(fields).eq("id", id));
  return (await getEpisode(id))!;
}
export async function moveEpisode(id: string, direction: "up" | "down") {
  await move("episodes", "topic_id", id, direction);
}
export async function deleteEpisode(id: string) {
  const client = await db();
  const episode = await getEpisode(id);
  check(await client.from("episodes").delete().eq("id", id));
  return episode?.media_url ?? "";
}

/** Enkel spørring som holder Supabase-prosjektet aktivt (brukes av den daglige cron-jobben). */
export async function ping() {
  const client = await db();
  check(await client.from("courses").select("id").limit(1));
}
