import { handle, HttpError, limitAttempts, readJson, requireTeacher, text } from "@/lib/auth";
import { geminiClient, isTransientGeminiError, mapGeminiError } from "@/lib/gemini";
import {
  MAX_TTS_REQUEST_CHARS,
  MAX_TTS_REQUEST_TURNS,
  PODCAST_MODELS,
  PODCAST_VOICE_IDS,
  type PodcastFormat,
  type PodcastQuality,
  type PodcastSpeaker,
} from "@/lib/podcast";

export const maxDuration = 60;

const SAMPLE_RATE = 24_000;

type ValidatedTurn = {
  speaker: PodcastSpeaker;
  text: string;
  style?: string;
};

/**
 * Konverterer én bolk av podkastmanuset til rå 24 kHz 16-bit mono PCM (audio/l16)
 * ved hjelp av Google Gemini 3.8 TTS. Returnerer binære lyddata direkte for å spare båndbredde
 * og holde seg godt under Vercels 4,5 MB svarstørrelse.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const teacher = await requireTeacher();
    limitAttempts(`podcast-tts:${teacher.id}`, 160, 60 * 60_000);

    const body = await readJson(request);
    const format: PodcastFormat = body.format === "solo" ? "solo" : "dialogue";
    const quality: PodcastQuality = body.quality === "fast" ? "fast" : "standard";
    const voiceA = text(body.voice_a, 40) || "Kore";
    const voiceB = text(body.voice_b, 40) || "Puck";

    if (!PODCAST_VOICE_IDS.has(voiceA) || (format === "dialogue" && !PODCAST_VOICE_IDS.has(voiceB))) {
      throw new HttpError(400, "Ugyldig stemmevalg.");
    }

    const hostA = (text(body.host_a_name, 32) || "VertA").replace(/[^a-zA-Z0-9æøåÆØÅ_-]/g, "") || "VertA";
    const rawHostB = (text(body.host_b_name, 32) || "VertB").replace(/[^a-zA-Z0-9æøåÆØÅ_-]/g, "") || "VertB";
    const hostB = rawHostB.toLowerCase() === hostA.toLowerCase() ? `${rawHostB}2` : rawHostB;

    const rawTurns = Array.isArray(body.turns) ? body.turns : [];
    if (!rawTurns.length) throw new HttpError(400, "Ingen replikker å lese inn.");
    if (rawTurns.length > MAX_TTS_REQUEST_TURNS) {
      throw new HttpError(400, `For mange replikker i én bolk (maks ${MAX_TTS_REQUEST_TURNS}).`);
    }

    const turns: ValidatedTurn[] = [];
    let totalChars = 0;
    for (const item of rawTurns) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const line = text(record.text, 1800);
      if (!line) continue;
      totalChars += line.length;
      const speaker: PodcastSpeaker = format === "solo" ? "A" : record.speaker === "B" ? "B" : "A";
      const style = text(record.style, 120);
      turns.push({ speaker, text: line, ...(style ? { style } : {}) });
    }

    if (!turns.length) throw new HttpError(400, "Replikkene i denne bolken er tomme.");
    if (totalChars > MAX_TTS_REQUEST_CHARS) {
      throw new HttpError(400, "Teksten i denne bolken er for lang. Del den opp i flere kortere replikker.");
    }

    const speakersPresent = new Set(turns.map((t) => t.speaker));
    const useMultiSpeaker = format === "dialogue" && speakersPresent.size > 1;
    const singleVoice = speakersPresent.has("B") && !speakersPresent.has("A") ? voiceB : voiceA;

    const content = turns.map((turn) => ({
      type: "text" as const,
      text: turn.text,
      annotations: [
        {
          type: "speech_metadata" as const,
          ...(useMultiSpeaker ? { speaker: turn.speaker === "B" ? hostB : hostA } : {}),
          ...(turn.style ? { style: turn.style } : {}),
        },
      ],
    }));

    const speechConfig = useMultiSpeaker
      ? {
          speakers: [
            { speaker: hostA, voice: voiceA },
            { speaker: hostB, voice: voiceB },
          ],
        }
      : [{ voice: singleVoice }];

    const ttsModels =
      quality === "fast"
        ? [PODCAST_MODELS.fast.id, PODCAST_MODELS.standard.id]
        : [PODCAST_MODELS.standard.id, PODCAST_MODELS.fast.id];

    try {
      const client = geminiClient("v1beta");
      let interaction: Awaited<ReturnType<typeof client.interactions.create>> | null = null;
      let lastError: unknown;

      for (const model of ttsModels) {
        try {
          interaction = await client.interactions.create({
            model,
            input: [{ type: "user_input", content }],
            store: false,
            response_format: {
              type: "audio",
              mime_type: "audio/l16",
              sample_rate: SAMPLE_RATE,
            },
            generation_config: {
              speech_config: speechConfig,
            },
          });
          break;
        } catch (err) {
          lastError = err;
          if (!isTransientGeminiError(err)) throw err;
          console.warn(`[gemini] ${model} midlertidig opptatt (503), prøver reservemodell …`);
        }
      }

      if (!interaction) throw lastError ?? new Error("Ingen svar fra Google TTS.");

      const base64Audio = interaction.output_audio?.data;
      if (!base64Audio) {
        throw new HttpError(502, "Google TTS returnerte ingen lyd for denne bolken. Prøv igjen.");
      }

      const pcm = Buffer.from(base64Audio, "base64");
      return new Response(new Uint8Array(pcm), {
        status: 200,
        headers: {
          "Content-Type": "application/octet-stream",
          "Cache-Control": "no-store",
          "X-Audio-Sample-Rate": String(SAMPLE_RATE),
          "X-Audio-Format": "audio/l16",
        },
      });
    } catch (error) {
      mapGeminiError(error);
    }
  });
}
