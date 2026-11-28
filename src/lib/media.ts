/**
 * Delte klient- og visningshjelpere for mediefiler, varighetsmåling, spiller-synkronisering
 * og strukturert visning av nøkkelpunkter.
 */

export const ACCEPTED_MEDIA_FILES = ".mp3,.m4a,.wav,.ogg,.aac,.flac,.mp4,.webm,.mov";
export const MEDIA_EXTENSION_REGEX = /\.(mp3|m4a|wav|ogg|aac|flac|mp4|webm|mov)$/i;
export const AUDIO_EXTENSION_REGEX = /\.(mp3|m4a|wav|ogg|aac|flac)$/i;
export const VIDEO_EXTENSION_REGEX = /\.(mp4|webm|mov)$/i;

export const PAUSE_PLAYER_EVENT = "lytterom:pause-player";

/** Ber hovedspilleren (PlayerContext) om å sette på pause, f.eks. når Studio starter en forhåndsvisning. */
export function pauseMainPlayer() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(PAUSE_PLAYER_EVENT));
  }
}

/** Leser varigheten i hele sekunder fra en lokal lyd- eller videofil i nettleseren. */
export function readMediaDuration(file: File): Promise<number> {
  return new Promise<number>((resolve) => {
    const element = document.createElement(VIDEO_EXTENSION_REGEX.test(file.name) ? "video" : "audio");
    const source = URL.createObjectURL(file);
    let finished = false;
    const timer = window.setTimeout(() => complete(0), 5000);

    function complete(seconds: number) {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      element.onloadedmetadata = null;
      element.onerror = null;
      element.removeAttribute("src");
      element.load();
      URL.revokeObjectURL(source);
      resolve(Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0);
    }

    element.preload = "metadata";
    element.onloadedmetadata = () => complete(element.duration);
    element.onerror = () => complete(0);
    element.src = source;
  });
}

export type StudyNoteBlock =
  | { kind: "bullets"; items: string[] }
  | { kind: "reflection"; items: string[] }
  | { kind: "paragraph"; text: string };

const REFLECTION_HEADING = /^(?:refleksjon(?:sspørsmål)?|spørsmål(?:\s+til\s+ettertanke)?|tenk\s+over|diskuter)\s*:?\s*(.*)$/i;
const BULLET_LINE = /^(?:[•*-]|\d+[.)])\s+(.+)$/;

/**
 * Deler rå nøkkelpunkter inn i strukturerte avsnitt, punktlister og refleksjonsspørsmål
 * for god typografi og lesbarhet på mobil og desktop.
 */
export function parseStudyNotes(raw: string): StudyNoteBlock[] {
  const normalized = raw.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];

  const blocks: StudyNoteBlock[] = [];
  let currentBullets: string[] = [];
  let currentReflections: string[] = [];
  let inReflectionSection = false;

  function flushBullets() {
    if (currentBullets.length) {
      blocks.push({ kind: "bullets", items: currentBullets });
      currentBullets = [];
    }
  }

  function flushReflections() {
    if (currentReflections.length) {
      blocks.push({ kind: "reflection", items: currentReflections });
      currentReflections = [];
    }
  }

  const lines = normalized.split("\n");
  let paragraphLines: string[] = [];

  function flushParagraph() {
    if (paragraphLines.length) {
      blocks.push({ kind: "paragraph", text: paragraphLines.join(" ") });
      paragraphLines = [];
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushBullets();
      continue;
    }

    const reflectionMatch = line.match(REFLECTION_HEADING);
    if (reflectionMatch) {
      flushParagraph();
      flushBullets();
      inReflectionSection = true;
      const inlineQuestion = reflectionMatch[1]?.trim();
      if (inlineQuestion) currentReflections.push(inlineQuestion);
      continue;
    }

    const bulletMatch = line.match(BULLET_LINE);
    if (inReflectionSection) {
      const item = bulletMatch ? bulletMatch[1].trim() : line;
      if (item) currentReflections.push(item);
      continue;
    }

    if (bulletMatch) {
      flushParagraph();
      currentBullets.push(bulletMatch[1].trim());
      continue;
    }

    // Spørsmål på slutten av teksten som slutter med '?' etter kulepunkter behandles naturlig som refleksjonsspørsmål.
    if (blocks.length > 0 && currentBullets.length === 0 && line.endsWith("?") && line.length < 240) {
      flushParagraph();
      currentReflections.push(line);
      continue;
    }

    flushBullets();
    paragraphLines.push(line);
  }

  flushParagraph();
  flushBullets();
  flushReflections();

  return blocks;
}
