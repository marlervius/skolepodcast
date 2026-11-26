import { NextResponse } from "next/server";
import { handle, HttpError, limitAttempts, readJson, requireCourseOwner, text } from "@/lib/auth";
import { getCourse, getTopic } from "@/lib/db";
import { geminiClient, isTransientGeminiError, mapGeminiError } from "@/lib/gemini";
import {
  MAX_SOURCE_CHARS,
  PODCAST_LANGUAGES,
  PODCAST_LENGTHS,
  type PodcastFormat,
  type PodcastLanguage,
  type PodcastLength,
  type PodcastScript,
  type PodcastSpeaker,
} from "@/lib/podcast";

export const maxDuration = 60;

const SCRIPT_SCHEMA = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description: "Fengende, tydelig og konkret episodetittel for elever (maks 100 tegn).",
    },
    description: {
      type: "string",
      description: "Kort ingress på 2–3 setninger som forklarer hva eleven lærer i episoden.",
    },
    study_notes: {
      type: "string",
      description: "3–5 korte kulepunkter (starter med '• ') med nøkkelbegreper og 2 refleksjonsspørsmål til slutt.",
    },
    turns: {
      type: "array",
      description: "Ordrett opplesningsmanus delt inn i naturlige replikker.",
      items: {
        type: "object",
        properties: {
          speaker: {
            type: "string",
            enum: ["A", "B"],
            description: "Hvem som snakker: 'A' for første vert/oppleser, 'B' for andre vert.",
          },
          text: {
            type: "string",
            description: "Ordrett muntlig tekst som skal leses høyt. Ingen sceneregier, markdown, kulepunkter eller talernavn.",
          },
          style: {
            type: "string",
            description: "Kort valgfri engelsk tonebeskrivelse (f.eks. 'warm and curious', 'calm and clear'). Kan være tom streng.",
          },
        },
        required: ["speaker", "text"],
      },
    },
  },
  required: ["title", "description", "study_notes", "turns"],
} as const;

type RawScript = {
  title?: unknown;
  description?: unknown;
  study_notes?: unknown;
  turns?: unknown;
};

/**
 * Genererer et redigerbart podkastmanus fra lærerens notater eller tema med Gemini 4 Hydrogen.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const body = await readJson(request);
    const courseId = text(body.course_id, 64);
    const topicId = text(body.topic_id, 64);
    if (!courseId) throw new HttpError(400, "Velg et fagrom først.");

    const teacher = await requireCourseOwner(courseId);
    limitAttempts(`podcast-script:${teacher.id}`, 25, 60 * 60_000);

    const sourceText = text(body.source_text, MAX_SOURCE_CHARS);
    if (sourceText.length < 20) {
      throw new HttpError(400, "Lim inn litt mer tekst eller beskriv temaet tydeligere (minst 20 tegn).");
    }

    const format: PodcastFormat = body.format === "solo" ? "solo" : "dialogue";
    const language: PodcastLanguage =
      body.language === "nn" || body.language === "en" ? body.language : "nb";
    const length: PodcastLength =
      body.length === "short" || body.length === "long" ? body.length : "medium";
    const hostA = text(body.host_a_name, 32) || (format === "solo" ? "Forteller" : "Nora");
    const hostB = text(body.host_b_name, 32) || "Henrik";
    const instructions = text(body.instructions, 800);

    const [course, topic] = await Promise.all([
      getCourse(courseId),
      topicId ? getTopic(topicId) : Promise.resolve(null),
    ]);

    const langSpec = PODCAST_LANGUAGES[language];
    const lenSpec = PODCAST_LENGTHS[length];

    const contextLines = [
      course ? `Fag: ${course.subject}${course.class_label ? ` (${course.class_label})` : ""} — Fagrom: ${course.title}` : "",
      topic && topic.course_id === courseId ? `Kapittel: ${topic.title}` : "",
    ].filter(Boolean);

    const systemInstruction = [
      "Du er en dyktig pedagogisk podkastprodusent for norske elever.",
      `Skriv alltid hele svaret (tittel, beskrivelse, nøkkelpunkter og manus) på ${langSpec.promptName}.`,
      format === "dialogue"
        ? `Lag en levende, varm og naturlig podkastsamtale mellom to verter: A (${hostA}) og B (${hostB}). Vertene skal spille på hverandre, stille gode spørsmål, gi konkrete eksempler og oppsummere hovedpoengene tydelig.`
        : `Lag en engasjerende, klar og godt strukturert muntlig gjennomgang lest av én oppleser: A (${hostA}). Bruk kun speaker 'A' i alle replikkene.`,
      "VIKTIGE REGLER FOR OPPLESNING (TTS):",
      "- Hver replikk i 'text' leses ordrett høyt av en talesyntese. Skriv naturlig muntlig språk som høres ekte ut.",
      "- Ikke bruk markdown (ingen **, *, #, kulepunkter eller klammeparenteser), ingen lydbeskrivelser som [musikk], og ikke skriv talernavn foran teksten.",
      "- Skriv ut forkortelser og symboler slik de sies høyt (f.eks. 'cirka', 'prosent', 'for eksempel', '1814').",
      "- Hold hver replikk passe kort (1–4 setninger) for god rytme. Du kan unntaksvis bruke <short pause> for en naturlig kunstpause.",
      "- Hold deg faglig tro mot kildeteksten. Ikke dikt opp feilaktige fakta.",
    ].join("\n");

    const userPrompt = [
      contextLines.length ? `Kontekst:\n${contextLines.join("\n")}` : "",
      `Ønsket lengde: ${lenSpec.label} (${lenSpec.minutesLabel}, cirka ${lenSpec.targetWords}, rundt ${lenSpec.turnRange}).`,
      instructions ? `Ekstra ønsker fra læreren:\n${instructions}` : "",
      `Kildemateriale / pensumnotater:\n"""\n${sourceText}\n"""`,
    ].filter(Boolean).join("\n\n");

    const SCRIPT_MODELS = ["gemini-4-hydrogen", "gemini-3.5-flash-lite", "gemini-4-argon"] as const;

    try {
      const client = geminiClient("v1beta");
      let interaction: Awaited<ReturnType<typeof client.interactions.create>> | null = null;
      let lastError: unknown;

      for (const model of SCRIPT_MODELS) {
        try {
          interaction = await client.interactions.create({
            model,
            system_instruction: systemInstruction,
            input: userPrompt,
            store: false,
            response_format: {
              type: "text",
              mime_type: "application/json",
              schema: SCRIPT_SCHEMA,
            },
          });
          break;
        } catch (err) {
          lastError = err;
          if (!isTransientGeminiError(err)) throw err;
          console.warn(`[gemini] ${model} midlertidig opptatt (503), prøver neste modell …`);
        }
      }

      if (!interaction) throw lastError ?? new Error("Ingen svar fra Gemini.");

      const rawText = interaction.output_text?.trim();
      if (!rawText) {
        throw new HttpError(502, "Gemini returnerte et tomt svar. Prøv igjen.");
      }

      let parsed: RawScript;
      try {
        parsed = JSON.parse(rawText) as RawScript;
      } catch {
        throw new HttpError(502, "Klarte ikke å tolke podkastmanuset fra Gemini. Prøv igjen.");
      }

      const rawTurns = Array.isArray(parsed.turns) ? parsed.turns : [];
      const turns = rawTurns
        .map((item, index) => {
          if (!item || typeof item !== "object") return null;
          const record = item as Record<string, unknown>;
          const turnText = text(record.text, 2000);
          if (!turnText) return null;
          const speaker: PodcastSpeaker =
            format === "solo" ? "A" : record.speaker === "B" ? "B" : "A";
          const style = text(record.style, 120);
          return {
            id: `turn-${Date.now()}-${index}`,
            speaker,
            text: turnText,
            ...(style ? { style } : {}),
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);

      if (!turns.length) {
        throw new HttpError(502, "Manusgenereringen ga ingen replikker. Prøv igjen med litt mer tekst.");
      }

      const script: PodcastScript = {
        title: text(parsed.title, 140) || "Ny podkastepisode",
        description: text(parsed.description, 1600),
        study_notes: text(parsed.study_notes, 8000),
        turns,
      };

      return NextResponse.json({ script });
    } catch (error) {
      mapGeminiError(error);
    }
  });
}
