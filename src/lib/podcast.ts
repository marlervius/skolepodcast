export type PodcastFormat = "dialogue" | "solo";
export type PodcastLanguage = "nb" | "nn" | "en";
export type PodcastLength = "short" | "medium" | "long";
export type PodcastQuality = "standard" | "fast";
export type PodcastSpeaker = "A" | "B";
export type PodcastStyle = "explainer" | "exam" | "debate" | "story" | "quiz";
export type PodcastLevel = "auto" | "middle" | "highschool" | "intro" | "deep";
export type PodcastRefinement = "simpler" | "examples" | "shorter";

export type PodcastTurn = {
  id: string;
  speaker: PodcastSpeaker;
  text: string;
  style?: string;
};

export type PodcastScript = {
  title: string;
  description: string;
  study_notes: string;
  turns: PodcastTurn[];
};

export type PodcastVoice = {
  id: string;
  label: string;
  tone: string;
};

/** Utvalgte forhåndsbygde Gemini 3.8 TTS-stemmer med norsk beskrivelse. */
export const PODCAST_VOICES: readonly PodcastVoice[] = [
  { id: "Kore", label: "Kore", tone: "Tydelig og stødig" },
  { id: "Puck", label: "Puck", tone: "Energisk og varm" },
  { id: "Charon", label: "Charon", tone: "Rolig og informativ" },
  { id: "Aoede", label: "Aoede", tone: "Ledig og naturlig" },
  { id: "Sulafat", label: "Sulafat", tone: "Varm og nær" },
  { id: "Sadaltager", label: "Sadaltager", tone: "Kunnskapsrik og klar" },
  { id: "Fenrir", label: "Fenrir", tone: "Engasjert og livlig" },
  { id: "Leda", label: "Leda", tone: "Ungdommelig og lett" },
  { id: "Gacrux", label: "Gacrux", tone: "Moden og rolig" },
  { id: "Achird", label: "Achird", tone: "Vennlig og imøtekommende" },
  { id: "Zephyr", label: "Zephyr", tone: "Lys og frisk" },
  { id: "Orus", label: "Orus", tone: "Fast og tydelig" },
] as const;

export const PODCAST_VOICE_IDS = new Set<string>(PODCAST_VOICES.map((v) => v.id));

export const PODCAST_LANGUAGES: Record<PodcastLanguage, { label: string; promptName: string }> = {
  nb: { label: "Norsk (bokmål)", promptName: "norsk bokmål" },
  nn: { label: "Norsk (nynorsk)", promptName: "norsk nynorsk" },
  en: { label: "Engelsk", promptName: "English" },
};

export const PODCAST_LENGTHS: Record<PodcastLength, { label: string; minutesLabel: string; targetWords: string; turnRange: string }> = {
  short: { label: "Kort", minutesLabel: "ca. 2–3 min", targetWords: "300–420 ord", turnRange: "8–12 replikker" },
  medium: { label: "Middels", minutesLabel: "ca. 5 min", targetWords: "650–800 ord", turnRange: "16–22 replikker" },
  long: { label: "Lang", minutesLabel: "ca. 8–10 min", targetWords: "1100–1400 ord", turnRange: "26–36 replikker" },
};

export const PODCAST_MODELS: Record<PodcastQuality, { id: string; label: string; hint: string }> = {
  standard: {
    id: "gemini-3.8-flash-tts",
    label: "Høy kvalitet",
    hint: "Gemini 3.8 Flash TTS — mest naturlig og uttrykksfull",
  },
  fast: {
    id: "gemini-3.8-flash-lite-tts",
    label: "Rask og rimelig",
    hint: "Gemini 3.8 Flash-Lite TTS — raskere og lavere kostnad",
  },
};

export const PODCAST_STYLES: Record<PodcastStyle, { label: string; hint: string; promptRule: string }> = {
  explainer: {
    label: "Forklarende samtale",
    hint: "Bygger forståelse steg for steg med hverdagseksempler",
    promptRule: "Start med en fengende åpning som vekker nysgjerrighet, forklar stoffet logisk steg for steg med konkrete eksempler, og avslutt med en kort oppsummering av det viktigste.",
  },
  exam: {
    label: "Eksamensrepetisjon",
    hint: "Strukturert, spisset og med rask oppsummering til slutt",
    promptRule: "Hold et effektivt og tydelig repetisjonstempo. Prioriter hovedsammenhenger, typiske eksamensspørsmål og vanlige fallgruver, og avslutt med en stram 3-punkts sjekkliste eleven bør huske.",
  },
  debate: {
    label: "To perspektiver",
    hint: "Drøfter ulike synspunkter, fordeler, ulemper og nyanser",
    promptRule: "Belys temaet fra minst to ulike perspektiver eller argumenter (i to-stemmers modus kan vertene utforske hvert sitt perspektiv respektfullt). Drøft styrker og svakheter før en balansert avrunding.",
  },
  story: {
    label: "Historie og case",
    hint: "Starter i en konkret hendelse og knytter teorien til den",
    promptRule: "Åpne midt i en levende, konkret case eller hendelse som gjør temaet nært og forståelig. Bruk casen som rød tråd gjennom hele episoden og trekk ut fagbegrepene fra den underveis.",
  },
  quiz: {
    label: "Quiz og repetisjon",
    hint: "Stiller kontrollspørsmål med kort tenkepause før fasit",
    promptRule: "Flett inn 3–4 korte kontrollspørsmål underveis i episoden. Etter hvert spørsmål, legg inn <short pause> slik at eleven rekker å tenke selv, og gi deretter et tydelig, oppmuntrende svar med kort forklaring.",
  },
};

export const PODCAST_LEVELS: Record<PodcastLevel, { label: string; promptRule: string }> = {
  auto: {
    label: "Tilpass etter fagrommet",
    promptRule: "Tilpass språknivå og faglig dybde til faget og klassetrinnet som står i konteksten.",
  },
  middle: {
    label: "Ungdomsskole (8.–10. trinn)",
    promptRule: "Tilpass til elever på ungdomsskolen (8.–10. trinn). Bruk tydelig, hverdagslig språk, forklar alle fagord med en gang og koble til ting ungdom kjenner igjen.",
  },
  highschool: {
    label: "Videregående (VG1–VG3)",
    promptRule: "Tilpass til elever på videregående skole (VG1–VG3). Bruk presise fagbegreper, legg vekt på årsak–virkning og drøfting, og gjør stoffet relevant for prøver og eksamen.",
  },
  intro: {
    label: "Enkel introduksjon",
    promptRule: "Forutsett ingen forkunnskaper. Forklar helt fra bunnen av i rolig tempo med enkle analogier og korte setninger.",
  },
  deep: {
    label: "Fordypning",
    promptRule: "Gå i dybden på nyanser, sammenhenger, motargumenter og sentrale fagbegreper for elever som allerede kan det grunnleggende.",
  },
};

export const PODCAST_REFINEMENTS: Record<PodcastRefinement, { label: string; instruction: string }> = {
  simpler: {
    label: "Gjør enklere",
    instruction: "Omskriv manuset slik at språket blir enklere, mer muntlig og lettere å forstå, med kortere setninger og tydeligere forklaringer av fagbegreper. Behold den røde tråden og faglig presisjon.",
  },
  examples: {
    label: "Flere eksempler",
    instruction: "Forbedre manuset ved å legge inn flere konkrete, engasjerende hverdagseksempler og gode analogier som gjør teorien lett å se for seg. Behold strukturen og den røde tråden.",
  },
  shorter: {
    label: "Stram inn",
    instruction: "Gjør manuset cirka 30 prosent kortere og mer poengtert. Kutt gjentakelser og småprat, men behold alle kjernebegreper, den røde tråden og en god avslutning.",
  },
};

export const TURN_STYLES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "Naturlig tone" },
  { value: "warm and enthusiastic", label: "Engasjert og varm" },
  { value: "calm and clear", label: "Rolig og forklarende" },
  { value: "curious and questioning", label: "Nysgjerrig" },
  { value: "lighthearted and friendly", label: "Lett og vennlig" },
  { value: "thoughtful and serious", label: "Ettertenksom" },
  { value: "energetic and upbeat", label: "Energisk" },
];

export const MAX_SOURCE_CHARS = 24_000;
export const MAX_TTS_CHUNK_CHARS = 950;
export const MAX_TTS_CHUNK_TURNS = 6;
export const MAX_TTS_REQUEST_CHARS = 2_400;
export const MAX_TTS_REQUEST_TURNS = 12;

export type TtsTurnInput = {
  speaker: PodcastSpeaker;
  text: string;
  style?: string;
};

/** Deler opp en veldig lang replikk ved setningsskille slik at hvert TTS-kall holder seg raskt og stabilt. */
function splitLongText(text: string, maxChars: number): string[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxChars) return cleaned ? [cleaned] : [];

  const sentences = cleaned.split(/(?<=[.!?…])\s+/);
  const parts: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (!sentence) continue;
    if (current && current.length + 1 + sentence.length > maxChars) {
      parts.push(current.trim());
      current = "";
    }
    if (sentence.length > maxChars) {
      if (current) {
        parts.push(current.trim());
        current = "";
      }
      // Del på mellomrom dersom en enkelt setning er ekstremt lang.
      let start = 0;
      while (start < sentence.length) {
        let end = Math.min(start + maxChars, sentence.length);
        if (end < sentence.length) {
          const space = sentence.lastIndexOf(" ", end);
          if (space > start + Math.floor(maxChars * 0.5)) end = space;
        }
        parts.push(sentence.slice(start, end).trim());
        start = end;
        while (start < sentence.length && sentence[start] === " ") start++;
      }
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/**
 * Grupperer replikker i trygge bolker for TTS-generering.
 * Hver bolk blir ca. 30–50 sekunder med lyd (~1,5–2,4 MB rå PCM), slik at hvert API-kall
 * fullfører raskt og godt innenfor tids- og størrelsesgrensene på Vercel.
 */
export function chunkPodcastTurns(
  turns: TtsTurnInput[],
  maxChars = MAX_TTS_CHUNK_CHARS,
  maxTurns = MAX_TTS_CHUNK_TURNS,
): TtsTurnInput[][] {
  const normalized: TtsTurnInput[] = [];
  for (const turn of turns) {
    const pieces = splitLongText(turn.text, maxChars);
    for (const piece of pieces) {
      normalized.push({
        speaker: turn.speaker,
        text: piece,
        ...(turn.style?.trim() ? { style: turn.style.trim() } : {}),
      });
    }
  }

  const chunks: TtsTurnInput[][] = [];
  let current: TtsTurnInput[] = [];
  let chars = 0;

  for (const turn of normalized) {
    if (current.length > 0 && (current.length >= maxTurns || chars + turn.text.length > maxChars)) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(turn);
    chars += turn.text.length;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** Grovt anslag på taletid (~140 ord i minuttet). */
export function estimateDurationSeconds(turns: Array<{ text: string }>): number {
  const words = turns.reduce((sum, t) => {
    const trimmed = t.text.trim();
    return sum + (trimmed ? trimmed.split(/\s+/).length : 0);
  }, 0);
  if (!words) return 0;
  return Math.max(5, Math.round((words / 140) * 60));
}

/** Konverterer ren tekst (eller «Navn: replikk»-linjer) til redigerbare replikker for direkte TTS. */
export function parseDirectScript(
  sourceText: string,
  format: PodcastFormat,
  hostA: string,
  hostB: string,
): PodcastTurn[] {
  const paragraphs = sourceText
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const aLower = hostA.trim().toLowerCase();
  const bLower = hostB.trim().toLowerCase();
  const turns: PodcastTurn[] = [];
  let nextSpeaker: PodcastSpeaker = "A";

  const makeId = (index: number) => `turn-${Date.now()}-${index}`;

  for (const block of paragraphs) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const looksLikeDialogue = format === "dialogue" && lines.some((l) => /^[^:]{1,28}:\s+\S/.test(l));

    if (looksLikeDialogue) {
      for (const line of lines) {
        const match = line.match(/^([^:]{1,28}):\s+(.+)$/);
        if (match) {
          const label = match[1].trim().toLowerCase();
          let speaker: PodcastSpeaker = nextSpeaker;
          if (label === aLower || label === "a" || label === "vert 1" || label === "programleder 1") {
            speaker = "A";
          } else if (label === bLower || label === "b" || label === "vert 2" || label === "programleder 2") {
            speaker = "B";
          }
          turns.push({ id: makeId(turns.length), speaker, text: match[2].trim() });
          nextSpeaker = speaker === "A" ? "B" : "A";
        } else {
          turns.push({ id: makeId(turns.length), speaker: nextSpeaker, text: line });
        }
      }
    } else {
      const joined = lines.join(" ");
      const speaker: PodcastSpeaker = format === "solo" ? "A" : nextSpeaker;
      turns.push({ id: makeId(turns.length), speaker, text: joined });
      if (format === "dialogue") nextSpeaker = speaker === "A" ? "B" : "A";
    }
  }

  return turns;
}
