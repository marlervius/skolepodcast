import { NextResponse } from "next/server";
import { handle, HttpError, limitAttempts, readJson, requireCourseOwner, text } from "@/lib/auth";
import { getCourse, getTopic } from "@/lib/db";
import { geminiClient, isTransientGeminiError, mapGeminiError } from "@/lib/gemini";
import {
  MAX_SOURCE_CHARS,
  PODCAST_LANGUAGES,
  PODCAST_LENGTHS,
  PODCAST_LEVELS,
  PODCAST_REFINEMENTS,
  PODCAST_STYLES,
  type PodcastAcademicOverview,
  type PodcastFactItem,
  type PodcastFormat,
  type PodcastLanguage,
  type PodcastLength,
  type PodcastLevel,
  type PodcastRefinement,
  type PodcastScript,
  type PodcastSpeaker,
  type PodcastStyle,
  type PodcastTheoryItem,
  type PodcastThesisItem,
} from "@/lib/podcast";

export const maxDuration = 60;

const ACADEMIC_OVERVIEW_SCHEMA = {
  type: "object",
  description: "Strukturert faglig oversikt for faglærer som skal kvalitetssikre podkasten før publisering.",
  properties: {
    summary: {
      type: "string",
      description: "2–3 konsise setninger til faglærer om hva episoden handler om, hvilken vinkling den tar og hva den røde tråden er.",
    },
    facts: {
      type: "array",
      description: "De viktigste faktaopplysningene, årstallene, tallene og konkrete påstandene som framsettes i manuset (3–10 punkter).",
      items: {
        type: "object",
        properties: {
          claim: {
            type: "string",
            description: "Kort, presis gjengivelse av faktapåstanden slik den framstilles i manuset.",
          },
          origin: {
            type: "string",
            enum: ["source", "added"],
            description: "'source' hvis påstanden har klar dekning i lærerens kildetekst; 'added' hvis den er lagt til fra generell kunnskap eller egne eksempler og bør dobbeltsjekkes.",
          },
          turn_numbers: {
            type: "array",
            description: "1-baserte replikknummer i 'turns' der dette omtales (f.eks. [2, 5]).",
            items: { type: "integer" },
          },
        },
        required: ["claim", "origin", "turn_numbers"],
      },
    },
    theories: {
      type: "array",
      description: "Teorier, modeller, fagbegreper eller forklaringsrammer som blir forklart eller brukt i manuset (0–8 punkter).",
      items: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Navn på teorien, modellen eller fagbegrepet.",
          },
          explanation: {
            type: "string",
            description: "Kort oppsummering (1–2 setninger) av hvordan teorien/begrepet blir forklart eller brukt i episoden.",
          },
          turn_numbers: {
            type: "array",
            description: "1-baserte replikknummer i 'turns' der dette omtales.",
            items: { type: "integer" },
          },
        },
        required: ["name", "explanation", "turn_numbers"],
      },
    },
    theses: {
      type: "array",
      description: "Hovedteser, årsakssammenhenger, argumenter eller drøftinger som diskuteres i manuset (1–6 punkter).",
      items: {
        type: "object",
        properties: {
          statement: {
            type: "string",
            description: "Hovedtesen, problemstillingen eller påstanden som drøftes.",
          },
          perspectives: {
            type: "string",
            description: "Kort om hvilke nyanser, belegg eller motperspektiver manuset trekker fram (kan være tom streng hvis bare én linje presenteres).",
          },
          turn_numbers: {
            type: "array",
            description: "1-baserte replikknummer i 'turns' der dette drøftes.",
            items: { type: "integer" },
          },
        },
        required: ["statement", "turn_numbers"],
      },
    },
    caveats: {
      type: "array",
      description: "1–4 konkrete merknader til faglærer om pedagogiske forenklinger, utelatte nyanser, analogier eller tilleggsopplysninger som bør vurderes faglig.",
      items: { type: "string" },
    },
  },
  required: ["summary", "facts", "theories", "theses", "caveats"],
} as const;

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
    academic_overview: ACADEMIC_OVERVIEW_SCHEMA,
  },
  required: ["title", "description", "study_notes", "turns", "academic_overview"],
} as const;

const REVIEW_ONLY_SCHEMA = {
  type: "object",
  properties: {
    academic_overview: ACADEMIC_OVERVIEW_SCHEMA,
  },
  required: ["academic_overview"],
} as const;

type RawScript = {
  title?: unknown;
  description?: unknown;
  study_notes?: unknown;
  turns?: unknown;
  academic_overview?: unknown;
};

function parseTurnNumbers(raw: unknown, maxTurn: number): number[] {
  if (!Array.isArray(raw) || maxTurn <= 0) return [];
  const seen = new Set<number>();
  for (const item of raw) {
    const n = Math.round(Number(item));
    if (Number.isFinite(n) && n >= 1 && n <= maxTurn) {
      seen.add(n);
    }
  }
  return Array.from(seen).sort((a, b) => a - b).slice(0, 8);
}

function parseAcademicOverview(raw: unknown, maxTurn: number): PodcastAcademicOverview | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  const summary = text(record.summary, 1000);

  const facts: PodcastFactItem[] = (Array.isArray(record.facts) ? record.facts : [])
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const r = item as Record<string, unknown>;
      const claim = text(r.claim, 400);
      if (!claim) return null;
      return {
        claim,
        origin: r.origin === "added" ? ("added" as const) : ("source" as const),
        turn_numbers: parseTurnNumbers(r.turn_numbers, maxTurn),
      };
    })
    .filter((item): item is PodcastFactItem => item !== null)
    .slice(0, 14);

  const theories: PodcastTheoryItem[] = (Array.isArray(record.theories) ? record.theories : [])
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const r = item as Record<string, unknown>;
      const name = text(r.name, 160);
      const explanation = text(r.explanation, 500);
      if (!name && !explanation) return null;
      return {
        name: name || "Begrep",
        explanation: explanation || name,
        turn_numbers: parseTurnNumbers(r.turn_numbers, maxTurn),
      };
    })
    .filter((item): item is PodcastTheoryItem => item !== null)
    .slice(0, 10);

  const theses: PodcastThesisItem[] = (Array.isArray(record.theses) ? record.theses : [])
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const r = item as Record<string, unknown>;
      const statement = text(r.statement, 450);
      if (!statement) return null;
      const perspectives = text(r.perspectives, 450);
      return {
        statement,
        ...(perspectives ? { perspectives } : {}),
        turn_numbers: parseTurnNumbers(r.turn_numbers, maxTurn),
      };
    })
    .filter((item): item is PodcastThesisItem => item !== null)
    .slice(0, 8);

  const caveats = (Array.isArray(record.caveats) ? record.caveats : [])
    .map((item) => text(item, 400))
    .filter(Boolean)
    .slice(0, 6);

  if (!summary && !facts.length && !theories.length && !theses.length && !caveats.length) {
    return undefined;
  }

  return { summary, facts, theories, theses, caveats };
}

const SCRIPT_MODELS = ["gemini-4-hydrogen", "gemini-3.5-flash-lite", "gemini-4-argon"] as const;

async function runStructuredPrompt(systemInstruction: string, userPrompt: string, schema: object) {
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
          schema,
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

  try {
    return JSON.parse(rawText) as RawScript;
  } catch {
    throw new HttpError(502, "Klarte ikke å tolke svaret fra Gemini. Prøv igjen.");
  }
}

/**
 * Genererer et redigerbart podkastmanus med faglig oversikt for lærer,
 * støtter både hurtigjustering, faglig korrigering og ren re-analyse av redigert manus.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const body = await readJson(request);
    const courseId = text(body.course_id, 64);
    const topicId = text(body.topic_id, 64);
    if (!courseId) throw new HttpError(400, "Velg et fagrom først.");

    const teacher = await requireCourseOwner(courseId);
    limitAttempts(`podcast-script:${teacher.id}`, 35, 60 * 60_000);

    const reviewOnly = body.review_only === true;
    const correction = text(body.correction, 1000);
    const refinement: PodcastRefinement | null =
      body.refinement === "simpler" || body.refinement === "examples" || body.refinement === "shorter"
        ? body.refinement
        : null;

    const existingTurnsRaw = Array.isArray(body.existing_turns) ? body.existing_turns : [];
    const existingTurns = existingTurnsRaw
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const record = item as Record<string, unknown>;
        const line = text(record.text, 1800);
        if (!line) return null;
        return {
          speaker: record.speaker === "B" ? "B" : "A",
          text: line,
        };
      })
      .filter((item): item is { speaker: string; text: string } => item !== null)
      .slice(0, 60);

    const sourceText = text(body.source_text, MAX_SOURCE_CHARS);
    const isEditingExisting = reviewOnly || Boolean(refinement) || Boolean(correction);

    if (!isEditingExisting && sourceText.length < 20) {
      throw new HttpError(400, "Lim inn litt mer tekst eller beskriv temaet tydeligere (minst 20 tegn).");
    }
    if (isEditingExisting && !existingTurns.length) {
      throw new HttpError(400, "Fant ikke noe manus å analysere eller justere.");
    }

    const format: PodcastFormat = body.format === "solo" ? "solo" : "dialogue";
    const language: PodcastLanguage =
      body.language === "nn" || body.language === "en" ? body.language : "nb";
    const length: PodcastLength =
      body.length === "short" || body.length === "long" ? body.length : "medium";
    const style: PodcastStyle =
      typeof body.style === "string" && body.style in PODCAST_STYLES
        ? (body.style as PodcastStyle)
        : "explainer";
    const level: PodcastLevel =
      typeof body.level === "string" && body.level in PODCAST_LEVELS
        ? (body.level as PodcastLevel)
        : "auto";
    const hostA = text(body.host_a_name, 32) || (format === "solo" ? "Forteller" : "Nora");
    const hostB = text(body.host_b_name, 32) || "Henrik";
    const mainThread = text(body.main_thread, 400);
    const focusAreas = text(body.focus_areas, 600);
    const instructions = text(body.instructions, 800);

    const [course, topic] = await Promise.all([
      getCourse(courseId),
      topicId ? getTopic(topicId) : Promise.resolve(null),
    ]);

    const langSpec = PODCAST_LANGUAGES[language];
    const lenSpec = PODCAST_LENGTHS[length];
    const styleSpec = PODCAST_STYLES[style];
    const levelSpec = PODCAST_LEVELS[level];

    const contextLines = [
      course ? `Fag: ${course.subject}${course.class_label ? ` (${course.class_label})` : ""} — Fagrom: ${course.title}` : "",
      topic && topic.course_id === courseId ? `Kapittel: ${topic.title}` : "",
    ].filter(Boolean);

    const academicRules = [
      "REGLER FOR FAGLIG OVERSIKT (academic_overview — til faglærerens kvalitetssikring):",
      "- Oversikten skal være saklig, etterrettelig og hjelpe faglærer å vurdere podkasten raskt før lydgenerering og publisering.",
      "- Oppsummer hva episoden faktisk tar opp (summary), hvilke konkrete fakta og påstander som framsettes (facts), hvilke teorier/modeller/fagbegreper som forklares (theories), og hvilke hovedteser/årsakssammenhenger/drøftinger som diskuteres (theses).",
      "- Vær helt ærlig på kildegrunnlaget i 'facts': bruk origin='source' kun når opplysningen har tydelig dekning i lærerens innsendte kildetekst, og origin='added' når manuset trekker inn tilleggsfakta, årstall eller eksempler utover kildeteksten (eller hvis kildeteksten bare er et kort tema). Slik ser læreren umiddelbart hva som bør dobbeltsjekkes.",
      "- Bruk nøyaktige 1-baserte replikknummer i 'turn_numbers' som peker til de konkrete replikkene i 'turns' (1 = første replikk).",
      "- I 'caveats', løft fram 1–4 relevante punkter om pedagogiske forenklinger, nyanser som er kuttet ut for målgruppen, eller påstander læreren bør kontrollere.",
    ].join("\n");

    const numberedExistingScript = existingTurns
      .map((t, index) => `#${index + 1} (${t.speaker}): ${t.text}`)
      .join("\n");

    try {
      // Modus 1: Ren faglig re-analyse av et eksisterende (ev. manuelt redigert) manus.
      if (reviewOnly) {
        const reviewSystem = [
          "Du er en grundig fagredaktør som bistår norske faglærere med faglig kvalitetssikring av undervisningspodkaster.",
          `Skriv hele svaret på ${langSpec.promptName}.`,
          academicRules,
        ].join("\n");

        const reviewPrompt = [
          contextLines.length ? `Kontekst:\n${contextLines.join("\n")}` : "",
          `Episodetittel: ${text(body.existing_title, 140) || "(ingen)"}`,
          `Ferdig podkastmanus som skal vurderes (nummerert fra #1 til #${existingTurns.length}):\n${numberedExistingScript}`,
          sourceText
            ? `Lærerens kildetekst (bruk denne for å avgjøre om fakta har origin='source' eller origin='added'):\n"""\n${sourceText.slice(0, 12_000)}\n"""`
            : "Ingen kildetekst er oppgitt — merk faktapåstander med origin='added' dersom de bør kontrolleres av faglærer.",
        ].filter(Boolean).join("\n\n");

        const parsed = await runStructuredPrompt(reviewSystem, reviewPrompt, REVIEW_ONLY_SCHEMA);
        const academic_overview = parseAcademicOverview(parsed.academic_overview, existingTurns.length);
        if (!academic_overview) {
          throw new HttpError(502, "Klarte ikke å lage faglig oversikt. Prøv igjen.");
        }
        return NextResponse.json({ academic_overview });
      }

      // Modus 2 & 3: Generer nytt manus eller juster/korriger eksisterende manus + faglig oversikt.
      const systemInstruction = [
        "Du er en dyktig pedagogisk podkastprodusent for norske elever.",
        `Skriv alltid hele svaret (tittel, beskrivelse, nøkkelpunkter, manus og faglig oversikt) på ${langSpec.promptName}.`,
        format === "dialogue"
          ? `Lag en levende, varm og naturlig podkastsamtale mellom to verter: A (${hostA}) og B (${hostB}). Vertene skal spille på hverandre, stille gode spørsmål, gi konkrete eksempler og oppsummere hovedpoengene tydelig.`
          : `Lag en engasjerende, klar og godt strukturert muntlig gjennomgang lest av én oppleser: A (${hostA}). Bruk kun speaker 'A' i alle replikkene.`,
        `EPISODESTIL (${styleSpec.label}): ${styleSpec.promptRule}`,
        `MÅLGRUPPE OG NIVÅ: ${levelSpec.promptRule}`,
        "VIKTIGE REGLER FOR OPPLESNING (TTS):",
        "- Hver replikk i 'text' leses ordrett høyt av en talesyntese. Skriv naturlig muntlig språk som høres ekte ut.",
        "- Ikke bruk markdown (ingen **, *, #, kulepunkter eller klammeparenteser), ingen lydbeskrivelser som [musikk], og ikke skriv talernavn foran teksten.",
        "- Skriv ut forkortelser og symboler slik de sies høyt (f.eks. 'cirka', 'prosent', 'for eksempel', '1814').",
        "- Hold hver replikk passe kort (1–4 setninger) for god rytme. Du kan bruke <short pause> der en naturlig tenkepause passer.",
        "- Hold deg faglig tro mot kildeteksten. Ikke dikt opp feilaktige fakta.",
        "- Sett eventuelt en kort engelsk leveringstone i 'style' (f.eks. 'warm and enthusiastic', 'calm and clear', 'curious and questioning') eller la den stå tom.",
        academicRules,
      ].join("\n");

      const guidanceLines = [
        mainThread
          ? `RØD TRÅD / KJERNESPØRSMÅL (vend tilbake til dette i åpning, underveis og avslutning):\n${mainThread}`
          : "",
        focusAreas
          ? `FOKUSOMRÅDER OG NØKKELBEGREPER (MÅ dekkes og forklares tydelig):\n${focusAreas}`
          : "",
        instructions ? `EKSTRA REGI / ØNSKER FRA LÆREREN:\n${instructions}` : "",
      ].filter(Boolean);

      const editTask = correction
        ? `OPPGAVE — FAGLIG KORRIGERING FRA LÆREREN (høyeste prioritet — rett manuset presist etter tilbakemeldingen og oppdater den faglige oversikten tilsvarende):\n${correction}`
        : refinement
          ? `OPPGAVE — JUSTER EKSISTERENDE MANUS (oppdater også den faglige oversikten slik at den samsvarer med det nye manuset):\n${PODCAST_REFINEMENTS[refinement].instruction}`
          : "";

      const userPrompt = editTask
        ? [
            contextLines.length ? `Kontekst:\n${contextLines.join("\n")}` : "",
            ...guidanceLines,
            editTask,
            `Nåværende tittel: ${text(body.existing_title, 140) || "(ingen)"}`,
            `Nåværende manus:\n${numberedExistingScript}`,
            sourceText ? `Opprinnelig kildetekst (for faktasjekk og kildegrunnlag):\n"""\n${sourceText.slice(0, 10_000)}\n"""` : "",
          ].filter(Boolean).join("\n\n")
        : [
            contextLines.length ? `Kontekst:\n${contextLines.join("\n")}` : "",
            `Ønsket lengde: ${lenSpec.label} (${lenSpec.minutesLabel}, cirka ${lenSpec.targetWords}, rundt ${lenSpec.turnRange}).`,
            ...guidanceLines,
            `Kildemateriale / pensumnotater:\n"""\n${sourceText}\n"""`,
          ].filter(Boolean).join("\n\n");

      const parsed = await runStructuredPrompt(systemInstruction, userPrompt, SCRIPT_SCHEMA);

      const rawTurns = Array.isArray(parsed.turns) ? parsed.turns : [];
      const turns = rawTurns
        .map((item, index) => {
          if (!item || typeof item !== "object") return null;
          const record = item as Record<string, unknown>;
          const turnText = text(record.text, 2000);
          if (!turnText) return null;
          const speaker: PodcastSpeaker =
            format === "solo" ? "A" : record.speaker === "B" ? "B" : "A";
          const turnStyle = text(record.style, 120);
          return {
            id: `turn-${Date.now()}-${index}`,
            speaker,
            text: turnText,
            ...(turnStyle ? { style: turnStyle } : {}),
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);

      if (!turns.length) {
        throw new HttpError(502, "Manusgenereringen ga ingen replikker. Prøv igjen med litt mer tekst.");
      }

      const academic_overview = parseAcademicOverview(parsed.academic_overview, turns.length);

      const script: PodcastScript = {
        title: text(parsed.title, 140) || "Ny podkastepisode",
        description: text(parsed.description, 1600),
        study_notes: text(parsed.study_notes, 8000),
        ...(academic_overview ? { academic_overview } : {}),
        turns,
      };

      return NextResponse.json({ script });
    } catch (error) {
      mapGeminiError(error);
    }
  });
}
