/**
 * Hjelpefunksjoner for NotebookLM-integrasjonen i Lærerstudio.
 * Validerer notatboklenker, rydder filnavn og studieguider, og gir ferdige prompt-maler.
 */

const ALLOWED_NOTEBOOK_HOSTS = new Set([
  "notebooklm.google.com",
  "notebooklm.google",
  "notebook.google.com",
]);

/**
 * Validerer en lenke til NotebookLM.
 * Returnerer tom streng hvis feltet er tomt, normalisert URL hvis gyldig, eller null hvis ugyldig.
 */
export function parseNotebookUrl(input: unknown): string | null {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return "";
  try {
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase();
    if (!ALLOWED_NOTEBOOK_HOSTS.has(host)) return null;
    url.protocol = "https:";
    return url.toString().slice(0, 500);
  } catch {
    return null;
  }
}

/**
 * Gjør et nedlastet NotebookLM-filnavn om til en lesbar episodetittel.
 * Fjerner filendelse, standardprefikser ("Audio Overview -", "Lydoversikt -") og "(1)"-suffikser.
 */
export function cleanNotebookFilename(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, "")
    .replace(/^(?:audio|video)\s+overview\s*[-–—:]\s*/i, "")
    .replace(/^(?:lyd|video)oversikt\s*[-–—:]\s*/i, "")
    .replace(/^\d{4}-\d{2}-\d{2}[_\s-]+/, "")
    .replace(/\s*\(\d+\)\s*$/, "")
    .replace(/[_]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 140);
}

/**
 * Rydder tekst limt inn fra NotebookLM (Study Guide, Briefing Doc eller chat)
 * og skiller ut en kort beskrivelse + strukturerte nøkkelpunkter og refleksjonsspørsmål.
 */
export function parseNotebookStudyNotes(raw: string): { description: string; studyNotes: string } {
  const cleanedLines = raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) =>
      line
        .replace(/^#{1,6}\s+/, "")
        .replace(/^\s*[*•]\s+/, "• ")
        .replace(/^\s*-\s+/, "• ")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/__([^_]+)__/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .trimEnd(),
    );

  // Samle sammenhengende avsnitt og fjern overflødige tomme linjer.
  const blocks: string[] = [];
  let current: string[] = [];
  for (const line of cleanedLines) {
    if (!line.trim()) {
      if (current.length) {
        blocks.push(current.join("\n").trim());
        current = [];
      }
    } else {
      current.push(line.trim());
    }
  }
  if (current.length) blocks.push(current.join("\n").trim());

  if (!blocks.length) return { description: "", studyNotes: "" };

  let description = "";
  const noteBlocks = [...blocks];

  // Hvis første avsnitt er en vanlig innledning (ikke punktliste eller ren overskrift), bruk det som forslag til beskrivelse.
  const first = noteBlocks[0];
  const isBulletBlock = first.startsWith("• ") || /^\d+\.\s/.test(first);
  const isShortHeading = !first.includes("\n") && first.length < 48 && !/[.!?]$/.test(first);
  if (!isBulletBlock && !isShortHeading && first.length >= 30) {
    description = first.slice(0, 320);
    if (noteBlocks.length > 1) noteBlocks.shift();
  }

  return {
    description,
    studyNotes: noteBlocks.join("\n\n").slice(0, 8000),
  };
}

export type NotebookPromptTemplate = {
  id: string;
  label: string;
  where: string;
  summary: string;
  build: (context: { courseTitle: string; subject: string; classLabel: string; topicTitle?: string }) => string;
};

function audienceText(subject: string, classLabel: string) {
  if (subject && classLabel) return `elever i ${subject} (${classLabel})`;
  if (subject) return `elever i ${subject}`;
  if (classLabel) return `elever på ${classLabel}`;
  return "elever";
}

export const NOTEBOOKLM_PROMPTS: NotebookPromptTemplate[] = [
  {
    id: "podcast-core",
    label: "Podkast: Forklar kapittelet",
    where: "Audio Overview → Tilpass",
    summary: "Engasjerende 6–8 min podkast på norsk tilpasset trinnet.",
    build: ({ subject, classLabel, topicTitle }) => {
      const target = audienceText(subject, classLabel);
      const topic = topicTitle ? ` om «${topicTitle}»` : "";
      return [
        `Lag en engasjerende lydoversikt på norsk for ${target}${topic}.`,
        "Hold lengden rundt 6–8 minutter. Forklar de viktigste begrepene med konkrete, gjenkjennelige eksempler, og unngå å ramse opp kildenavn.",
        "Avslutt med en kort oppsummering av de tre viktigste tingene elevene bør huske til timen.",
      ].join("\n\n");
    },
  },
  {
    id: "podcast-exam",
    label: "Podkast: Før prøve og eksamen",
    where: "Audio Overview → Tilpass",
    summary: "Spisset repetisjon av årsaker, sammenhenger og vanlige fallgruver.",
    build: ({ subject, classLabel, topicTitle }) => {
      const target = audienceText(subject, classLabel);
      const topic = topicTitle ? ` i kapittelet «${topicTitle}»` : "";
      return [
        `Lag en effektiv repetisjonspodkast på norsk for ${target} før prøve${topic}.`,
        "Fokuser på årsak og virkning, sentrale fagbegreper, og 2–3 vanlige misforståelser elevene bør unngå.",
        "Still to korte kontrollspørsmål underveis med en liten tenkepause før svaret forklares.",
      ].join("\n\n");
    },
  },
  {
    id: "video-explainer",
    label: "Videooversikt: Visuell gjennomgang",
    where: "Video Overview → Tilpass",
    summary: "Tydelig forklaringsvideo med steg-for-steg-oppbygging.",
    build: ({ subject, classLabel, topicTitle }) => {
      const target = audienceText(subject, classLabel);
      const topic = topicTitle ? ` om «${topicTitle}»` : "";
      return [
        `Lag en tydelig og visuell videooversikt på norsk for ${target}${topic}.`,
        "Bygg opp forklaringen steg for steg: start med hovedspørsmålet, vis de viktigste sammenhengene tydelig på skjermen, og avslutt med en oppsummering.",
      ].join("\n\n");
    },
  },
  {
    id: "study-notes",
    label: "Nøkkelpunkter og spørsmål",
    where: "NotebookLM-chat",
    summary: "Ferdig tekst du kan lime rett inn i feltet for nøkkelpunkter i Lytterom.",
    build: ({ subject, classLabel, topicTitle }) => {
      const target = audienceText(subject, classLabel);
      const topic = topicTitle ? ` om «${topicTitle}»` : "";
      return [
        `Skriv en kort tekst på norsk for ${target}${topic} som jeg skal legge under podkastepisoden i Lytterom:`,
        "1. En kort beskrivelse på 2 setninger som forklarer hva episoden handler om.",
        "2. 5 konkrete nøkkelpunkter med kulepunkter (•).",
        "3. 3 refleksjonsspørsmål elevene kan tenke over etter at de har lyttet.",
        "Hold språket klart og elevvennlig, uten kildehenvisninger i teksten.",
      ].join("\n");
    },
  },
];
