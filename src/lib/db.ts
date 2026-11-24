import { mkdirSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync as DatabaseSyncType, SQLInputValue } from "node:sqlite";
import { dataPath } from "./data-path";
import { hashPassword } from "./password";
import { DEMO_COURSE_ID, DEMO_EMAIL, DEMO_TEACHER_ID, demoCourse, demoEpisodes, demoTopics } from "./demo";
import type { Course, CourseSummary, Episode, MediaType, Teacher, Topic } from "./types";

// node:sqlite hentes direkte fra Node sin innebygde modulliste, slik at bundleren aldri prøver å løse den opp.
const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");

type Row = Record<string, SQLInputValue>;
const globalForDb = globalThis as unknown as { lytteromDb?: DatabaseSyncType };

const SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS teachers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  class_label TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  accent_color TEXT NOT NULL DEFAULT '#C0563B',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  study_notes TEXT NOT NULL DEFAULT '',
  media_type TEXT NOT NULL CHECK (media_type IN ('audio','video','embed')),
  media_url TEXT NOT NULL DEFAULT '',
  embed_url TEXT NOT NULL DEFAULT '',
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_courses_teacher ON courses(teacher_id);
CREATE INDEX IF NOT EXISTS idx_topics_course ON topics(course_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_episodes_topic ON episodes(topic_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_episodes_course ON episodes(course_id);
`;

function db(): DatabaseSyncType {
  if (globalForDb.lytteromDb) return globalForDb.lytteromDb;
  mkdirSync(dataPath(), { recursive: true });
  const database = new DatabaseSync(dataPath("lytterom.db"));
  database.exec(SCHEMA);
  seedDemo(database);
  globalForDb.lytteromDb = database;
  return database;
}

function seedDemo(database: DatabaseSyncType) {
  if (database.prepare("SELECT 1 FROM teachers WHERE id = ?").get(DEMO_TEACHER_ID)) return;
  transaction(database, () => {
    database.prepare("INSERT INTO teachers (id, name, email, password_hash) VALUES (?, ?, ?, ?)")
      .run(DEMO_TEACHER_ID, "Demolærer Historie", DEMO_EMAIL, hashPassword(demoPassword()));
    const course = demoCourse;
    database.prepare(`INSERT INTO courses (id, teacher_id, title, subject, class_label, description, code, accent_color)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(DEMO_COURSE_ID, DEMO_TEACHER_ID, course.title, course.subject, course.class_label, course.description, course.code, course.accent_color);
    const topic = database.prepare("INSERT INTO topics (id, course_id, title, description, sort_order) VALUES (?, ?, ?, ?, ?)");
    for (const item of demoTopics) topic.run(item.id, item.course_id, item.title, item.description, item.sort_order);
    const episode = database.prepare(`INSERT INTO episodes (id, topic_id, course_id, title, description, study_notes, media_type, media_url, embed_url, duration_seconds, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const item of demoEpisodes) {
      episode.run(item.id, item.topic_id, item.course_id, item.title, item.description, item.study_notes, item.media_type, item.media_url, item.embed_url, item.duration_seconds, item.sort_order);
    }
  });
}

// Demopassordet står i README, så i produksjon får demokontoen et tilfeldig passord ingen kjenner.
function demoPassword() {
  if (process.env.NODE_ENV !== "production") return "historie123";
  return randomBytes(32).toString("hex");
}

function transaction<T>(database: DatabaseSyncType, work: () => T): T {
  database.exec("BEGIN");
  try {
    const result = work();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function plain<T>(row: unknown): T {
  return { ...(row as object) } as T;
}
function all<T>(sql: string, ...params: SQLInputValue[]): T[] {
  return db().prepare(sql).all(...params).map((row) => plain<T>(row));
}
function one<T>(sql: string, ...params: SQLInputValue[]): T | null {
  const row = db().prepare(sql).get(...params);
  return row ? plain<T>(row) : null;
}
function run(sql: string, ...params: SQLInputValue[]) {
  return db().prepare(sql).run(...params);
}

/* ---------- Lærere ---------- */

export function createTeacher(name: string, email: string, passwordHash: string): Teacher {
  const id = randomUUID();
  run("INSERT INTO teachers (id, name, email, password_hash) VALUES (?, ?, ?, ?)", id, name, email, passwordHash);
  return getTeacher(id)!;
}
export function getTeacher(id: string) {
  return one<Teacher>("SELECT id, name, email, created_at FROM teachers WHERE id = ?", id);
}
export function findTeacherByEmail(email: string) {
  return one<Teacher & { password_hash: string }>("SELECT * FROM teachers WHERE email = ?", email);
}

/* ---------- Fagrom ---------- */

const SUMMARY_SELECT = `
SELECT c.*, t.name AS teacher_name,
  (SELECT COUNT(*) FROM episodes e WHERE e.course_id = c.id) AS episode_count,
  (SELECT COUNT(*) FROM topics tp WHERE tp.course_id = c.id) AS topic_count
FROM courses c JOIN teachers t ON t.id = c.teacher_id`;

export function listTeacherCourses(teacherId: string) {
  return all<CourseSummary>(`${SUMMARY_SELECT} WHERE c.teacher_id = ? ORDER BY c.created_at DESC`, teacherId);
}
export function getCourseSummariesByCodes(codes: string[]) {
  if (!codes.length) return [];
  const rows = all<CourseSummary>(`${SUMMARY_SELECT} WHERE c.code IN (${codes.map(() => "?").join(",")})`, ...codes);
  const order = codes.map((code) => code.toUpperCase());
  return rows.sort((a, b) => order.indexOf(a.code.toUpperCase()) - order.indexOf(b.code.toUpperCase()));
}
export function getCourseSummaryByCode(code: string) {
  return one<CourseSummary>(`${SUMMARY_SELECT} WHERE c.code = ?`, code);
}
function getCourseSummary(id: string) {
  return one<CourseSummary>(`${SUMMARY_SELECT} WHERE c.id = ?`, id);
}

function withContent(summary: CourseSummary | null): Course | null {
  if (!summary) return null;
  const topics = all<Omit<Topic, "episodes">>("SELECT * FROM topics WHERE course_id = ? ORDER BY sort_order, created_at", summary.id);
  const episodes = all<Episode>("SELECT * FROM episodes WHERE course_id = ? ORDER BY sort_order, created_at", summary.id);
  return {
    ...summary,
    topics: topics.map((topic) => ({ ...topic, episodes: episodes.filter((episode) => episode.topic_id === topic.id) })),
  };
}
export function getCourse(id: string) {
  return withContent(getCourseSummary(id));
}
export function getCourseByCode(code: string) {
  return withContent(getCourseSummaryByCode(code));
}
export function isCodeTaken(code: string, exceptId = "") {
  return Boolean(one("SELECT id FROM courses WHERE code = ? AND id <> ?", code, exceptId));
}

export type CourseInput = {
  title: string;
  subject: string;
  class_label: string;
  description: string;
  code: string;
  accent_color: string;
};

export function createCourse(teacherId: string, input: CourseInput, firstTopicTitle: string) {
  const id = randomUUID();
  transaction(db(), () => {
    run(`INSERT INTO courses (id, teacher_id, title, subject, class_label, description, code, accent_color) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id, teacherId, input.title, input.subject, input.class_label, input.description, input.code, input.accent_color);
    run("INSERT INTO topics (id, course_id, title, description, sort_order) VALUES (?, ?, ?, '', 0)", randomUUID(), id, firstTopicTitle);
  });
  return getCourse(id)!;
}
export function updateCourse(id: string, input: Partial<CourseInput>) {
  const fields = (["title", "subject", "class_label", "description", "code", "accent_color"] as const).filter((key) => input[key] !== undefined);
  if (fields.length) run(`UPDATE courses SET ${fields.map((key) => `${key} = ?`).join(", ")} WHERE id = ?`, ...fields.map((key) => input[key]!), id);
  return getCourse(id)!;
}
/** Sletter fagrommet og returnerer adressene til opplastede filer som må ryddes bort. */
export function deleteCourse(id: string) {
  const media = all<{ media_url: string }>("SELECT media_url FROM episodes WHERE course_id = ?", id).map((row) => row.media_url);
  run("DELETE FROM courses WHERE id = ?", id);
  return media;
}
export function courseOwner(id: string) {
  return one<{ teacher_id: string }>("SELECT teacher_id FROM courses WHERE id = ?", id)?.teacher_id ?? null;
}

/* ---------- Kapitler ---------- */

export function createTopic(courseId: string, title: string, description: string) {
  const id = randomUUID();
  const next = one<{ next: number }>("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM topics WHERE course_id = ?", courseId)!.next;
  run("INSERT INTO topics (id, course_id, title, description, sort_order) VALUES (?, ?, ?, ?, ?)", id, courseId, title, description, next);
  return getTopic(id)!;
}
export function getTopic(id: string) {
  return one<Omit<Topic, "episodes">>("SELECT * FROM topics WHERE id = ?", id);
}
export function updateTopic(id: string, input: { title?: string; description?: string }) {
  if (input.title !== undefined) run("UPDATE topics SET title = ? WHERE id = ?", input.title, id);
  if (input.description !== undefined) run("UPDATE topics SET description = ? WHERE id = ?", input.description, id);
  return getTopic(id)!;
}
export function deleteTopic(id: string) {
  const media = all<{ media_url: string }>("SELECT media_url FROM episodes WHERE topic_id = ?", id).map((row) => row.media_url);
  run("DELETE FROM topics WHERE id = ?", id);
  return media;
}

/** Flytter et kapittel eller en episode ett steg opp eller ned blant søsknene. */
function move(table: "topics" | "episodes", parentColumn: "course_id" | "topic_id", id: string, direction: "up" | "down") {
  const item = one<Record<string, string>>(`SELECT ${parentColumn} AS parent FROM ${table} WHERE id = ?`, id);
  if (!item) return;
  const siblings = all<{ id: string }>(`SELECT id FROM ${table} WHERE ${parentColumn} = ? ORDER BY sort_order, created_at`, item.parent);
  const index = siblings.findIndex((sibling) => sibling.id === id);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= siblings.length) return;
  [siblings[index], siblings[target]] = [siblings[target], siblings[index]];
  transaction(db(), () => {
    siblings.forEach((sibling, order) => run(`UPDATE ${table} SET sort_order = ? WHERE id = ?`, order, sibling.id));
  });
}
export function moveTopic(id: string, direction: "up" | "down") {
  move("topics", "course_id", id, direction);
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

export function createEpisode(input: EpisodeInput) {
  const id = randomUUID();
  const next = one<{ next: number }>("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM episodes WHERE topic_id = ?", input.topic_id)!.next;
  run(`INSERT INTO episodes (id, topic_id, course_id, title, description, study_notes, media_type, media_url, embed_url, duration_seconds, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  id, input.topic_id, input.course_id, input.title, input.description, input.study_notes, input.media_type, input.media_url, input.embed_url, input.duration_seconds, next);
  return getEpisode(id)!;
}
export function getEpisode(id: string) {
  return one<Episode>("SELECT * FROM episodes WHERE id = ?", id);
}
export function updateEpisode(id: string, input: Partial<Pick<Episode, "title" | "description" | "study_notes" | "topic_id">>) {
  if (input.topic_id !== undefined) {
    const current = getEpisode(id);
    if (current && current.topic_id !== input.topic_id) {
      const next = one<{ next: number }>("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM episodes WHERE topic_id = ?", input.topic_id)!.next;
      run("UPDATE episodes SET topic_id = ?, sort_order = ? WHERE id = ?", input.topic_id, next, id);
    }
  }
  for (const key of ["title", "description", "study_notes"] as const) {
    if (input[key] !== undefined) run(`UPDATE episodes SET ${key} = ? WHERE id = ?`, input[key]!, id);
  }
  return getEpisode(id)!;
}
export function moveEpisode(id: string, direction: "up" | "down") {
  move("episodes", "topic_id", id, direction);
}
export function deleteEpisode(id: string) {
  const episode = getEpisode(id);
  run("DELETE FROM episodes WHERE id = ?", id);
  return episode?.media_url ?? "";
}
