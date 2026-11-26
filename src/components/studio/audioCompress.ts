/**
 * Komprimerer store WAV-lydfiler (typisk fra NotebookLM) direkte i nettleseren før opplasting.
 *
 * Strategi:
 * 1. Dekoder lyden med Web Audio API.
 * 2. Hvis nettleseren støtter WebCodecs AudioEncoder (AAC-LC / mp4a.40.2), kodes lyden til en
 *    kompakt .m4a-fil (~96 kbps) som spilles av i alle nettlesere og iOS AVPlayer (ofte 10–20× mindre).
 * 3. Fallback hvis WebCodecs AAC mangler: nedsampler til 22,05 kHz mono 16-bit WAV (ca. 4× mindre).
 */

export type CompressionResult = {
  file: File;
  compressed: boolean;
  originalBytes: number;
  finalBytes: number;
  durationSeconds: number;
};

export function isWavFile(file: File) {
  return /\.wav$/i.test(file.name) || file.type === "audio/wav" || file.type === "audio/x-wav";
}

export function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/**
 * Skjøter sammen rå 16-bit signed little-endian mono PCM-bolker (fra Gemini TTS audio/l16)
 * til én gyldig WAV-fil, med en kort stille pause mellom bolkene for naturlig flyt.
 */
export function pcmChunksToWavFile(
  chunks: ArrayBuffer[],
  sampleRate: number,
  filename: string,
  pauseMs = 220,
): File {
  const validChunks = chunks.map((buf) => {
    const usable = buf.byteLength - (buf.byteLength % 2);
    return new Uint8Array(buf, 0, usable);
  }).filter((chunk) => chunk.byteLength > 0);

  const pauseSamples = Math.max(0, Math.round((sampleRate * pauseMs) / 1000));
  const pauseBytes = pauseSamples * 2;
  const totalPcmBytes =
    validChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0) +
    Math.max(0, validChunks.length - 1) * pauseBytes;

  const out = new ArrayBuffer(44 + totalPcmBytes);
  const view = new DataView(out);
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + totalPcmBytes, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, totalPcmBytes, true);

  const bytes = new Uint8Array(out);
  let offset = 44;
  validChunks.forEach((chunk, index) => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
    if (index < validChunks.length - 1 && pauseBytes > 0) {
      // Null-bytes (stillhet) er allerede nullstilt i ny ArrayBuffer.
      offset += pauseBytes;
    }
  });

  const safeBase = filename.replace(/\.[^.]+$/, "").trim() || "podcast";
  return new File([out], `${safeBase}.wav`, { type: "audio/wav" });
}

/**
 * Komprimerer en lydfil hvis den er WAV (eller over maxBytes).
 * Returnerer den originale filen uendret hvis komprimering ikke hjelper eller ikke støttes.
 */
export async function compressAudioForUpload(
  file: File,
  onStatus?: (label: string) => void,
): Promise<CompressionResult> {
  const originalBytes = file.size;
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) {
    return { file, compressed: false, originalBytes, finalBytes: originalBytes, durationSeconds: 0 };
  }

  onStatus?.("Leser lydfil …");
  const arrayBuffer = await file.arrayBuffer();
  const context = new AudioCtx();
  let decoded: AudioBuffer;
  try {
    decoded = await context.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    await context.close().catch(() => undefined);
  }

  const durationSeconds = Number.isFinite(decoded.duration) ? Math.round(decoded.duration) : 0;
  const baseName = file.name.replace(/\.[^.]+$/, "");

  // Forsøk 1: WebCodecs AAC-LC → M4A (best kvalitet og størrelse, full iOS- og nettleserstøtte).
  const m4a = await encodeAacM4a(decoded, onStatus).catch(() => null);
  if (m4a && m4a.byteLength < originalBytes * 0.9) {
    const out = new File([m4a], `${baseName}.m4a`, { type: "audio/mp4" });
    return { file: out, compressed: true, originalBytes, finalBytes: out.size, durationSeconds };
  }

  // Forsøk 2: Nedsamplet 22,05 kHz mono 16-bit WAV (universal fallback).
  onStatus?.("Optimaliserer lydfil …");
  const monoWav = await encodeCompactMonoWav(decoded).catch(() => null);
  if (monoWav && monoWav.byteLength < originalBytes * 0.85) {
    const out = new File([monoWav], `${baseName}.wav`, { type: "audio/wav" });
    return { file: out, compressed: true, originalBytes, finalBytes: out.size, durationSeconds };
  }

  return { file, compressed: false, originalBytes, finalBytes: originalBytes, durationSeconds };
}

/* ---------- WebCodecs AAC-LC → M4A (ISO BMFF) ---------- */

async function encodeAacM4a(buffer: AudioBuffer, onStatus?: (label: string) => void): Promise<ArrayBuffer | null> {
  if (typeof AudioEncoder === "undefined" || typeof AudioData === "undefined") return null;

  // Podcast-tale trenger sjelden mer enn 44,1 kHz mono (eller stereo hvis allerede 44,1/48 kHz).
  // Mono 44,1 kHz ved 96 kbps gir krystallklar tale og halverer rådataene inn i koderen.
  const targetSampleRate = buffer.sampleRate === 48000 ? 48000 : 44100;
  const targetChannels = 1;
  const bitrate = 96_000;

  const config: AudioEncoderConfig = {
    codec: "mp4a.40.2",
    sampleRate: targetSampleRate,
    numberOfChannels: targetChannels,
    bitrate,
  };

  const support = await AudioEncoder.isConfigSupported(config);
  if (!support.supported) return null;

  onStatus?.("Komprimerer lyd til M4A …");
  const monoPcm = await resampleToMono(buffer, targetSampleRate);

  const chunks: Uint8Array[] = [];
  const state: { asc: Uint8Array | null; error: Error | null } = { asc: null, error: null };

  const encoder = new AudioEncoder({
    output(chunk, metadata) {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      chunks.push(data);
      const desc = metadata?.decoderConfig?.description;
      if (!state.asc && desc) {
        if (ArrayBuffer.isView(desc)) {
          state.asc = new Uint8Array(desc.buffer.slice(desc.byteOffset, desc.byteOffset + desc.byteLength));
        } else {
          state.asc = new Uint8Array(desc.slice(0));
        }
      }
    },
    error(err) {
      state.error = err instanceof Error ? err : new Error("Kunne ikke kode lyd.");
    },
  });

  encoder.configure(config);

  const frameSize = 1024;
  const batchFrames = frameSize * 64; // ~1,5 sek per AudioData for god ytelse
  for (let offset = 0; offset < monoPcm.length; offset += batchFrames) {
    if (state.error) throw state.error;
    const end = Math.min(offset + batchFrames, monoPcm.length);
    const slice = new Float32Array(monoPcm.subarray(offset, end));
    const timestampUs = Math.round((offset / targetSampleRate) * 1_000_000);
    const audioData = new AudioData({
      format: "f32-planar",
      sampleRate: targetSampleRate,
      numberOfFrames: slice.length,
      numberOfChannels: targetChannels,
      timestamp: timestampUs,
      data: slice,
    });
    encoder.encode(audioData);
    audioData.close();
  }

  await encoder.flush();
  encoder.close();
  if (state.error) throw state.error;
  if (!chunks.length) return null;

  const asc = state.asc && state.asc.length >= 2
    ? state.asc
    : buildAacAudioSpecificConfig(targetSampleRate, targetChannels);

  return muxAacToM4a({
    chunks,
    sampleRate: targetSampleRate,
    channels: targetChannels,
    audioSpecificConfig: asc,
    bitrate,
  });
}

async function resampleToMono(buffer: AudioBuffer, targetSampleRate: number): Promise<Float32Array> {
  const length = Math.max(1, Math.ceil(buffer.duration * targetSampleRate));
  const offline = new OfflineAudioContext(1, length, targetSampleRate);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

/** Bygger 2-byte AudioSpecificConfig for AAC-LC (objectType = 2). */
function buildAacAudioSpecificConfig(sampleRate: number, channels: number): Uint8Array {
  const rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
  const freqIndex = Math.max(0, rates.indexOf(sampleRate));
  const objectType = 2; // AAC-LC
  const byte0 = (objectType << 3) | (freqIndex >> 1);
  const byte1 = ((freqIndex & 1) << 7) | (channels << 3);
  return new Uint8Array([byte0, byte1]);
}

/**
 * Pakker rå AAC-LC-rammer inn i en standard M4A-container (ISO BMFF) med moov før mdat
 * slik at både nettlesere og iOS AVPlayer kan starte avspilling og spole umiddelbart.
 */
export function muxAacToM4a({
  chunks,
  sampleRate,
  channels,
  audioSpecificConfig,
  bitrate,
}: {
  chunks: Uint8Array[];
  sampleRate: number;
  channels: number;
  audioSpecificConfig: Uint8Array;
  bitrate: number;
}): ArrayBuffer {
  const samplesPerFrame = 1024;
  const totalSamples = chunks.length * samplesPerFrame;
  const totalMdatPayload = chunks.reduce((sum, c) => sum + c.byteLength, 0);

  const ftyp = box("ftyp", concat([
    ascii("M4A "),
    u32(0),
    ascii("M4A "),
    ascii("mp42"),
    ascii("isom"),
  ]));

  const buildMoov = (mdatDataOffset: number) => {
    const mvhd = fullBox("mvhd", 0, 0, concat([
      u32(0), // creation_time
      u32(0), // modification_time
      u32(sampleRate),
      u32(totalSamples),
      u32(0x00010000), // rate 1.0
      u16(0x0100), // volume 1.0
      new Uint8Array(10), // reserved
      // identity matrix (9 * 4 bytes)
      u32(0x00010000), u32(0), u32(0),
      u32(0), u32(0x00010000), u32(0),
      u32(0), u32(0), u32(0x40000000),
      new Uint8Array(24), // pre_defined
      u32(2), // next_track_id
    ]));

    const tkhd = fullBox("tkhd", 0, 3, concat([
      u32(0), u32(0), // creation, mod
      u32(1), // track_id
      u32(0), // reserved
      u32(totalSamples),
      new Uint8Array(8), // reserved
      u16(0), u16(0), // layer, alternate_group
      u16(0x0100), u16(0), // volume, reserved
      u32(0x00010000), u32(0), u32(0),
      u32(0), u32(0x00010000), u32(0),
      u32(0), u32(0), u32(0x40000000),
      u32(0), u32(0), // width, height
    ]));

    const mdhd = fullBox("mdhd", 0, 0, concat([
      u32(0), u32(0),
      u32(sampleRate),
      u32(totalSamples),
      u16(0x55c4), // language "und"
      u16(0),
    ]));

    const hdlr = fullBox("hdlr", 0, 0, concat([
      u32(0),
      ascii("soun"),
      new Uint8Array(12),
      ascii("SoundHandler\0"),
    ]));

    const smhd = fullBox("smhd", 0, 0, new Uint8Array(4));
    const dref = fullBox("dref", 0, 0, concat([u32(1), fullBox("url ", 0, 1, new Uint8Array(0))]));
    const dinf = box("dinf", dref);

    // esds (Elementary Stream Descriptor for AAC-LC)
    const decSpecificInfo = descriptor(0x05, audioSpecificConfig);
    const decConfig = descriptor(0x04, concat([
      new Uint8Array([0x40, 0x15, 0x00, 0x00, 0x00]), // MPEG-4 audio, streamType=audio, bufferSize=0
      u32(bitrate),
      u32(bitrate),
      decSpecificInfo,
    ]));
    const slConfig = descriptor(0x06, new Uint8Array([0x02]));
    const esDescr = descriptor(0x03, concat([u16(1), new Uint8Array([0x00]), decConfig, slConfig]));
    const esds = fullBox("esds", 0, 0, esDescr);

    const mp4a = box("mp4a", concat([
      new Uint8Array(6), // reserved
      u16(1), // data_reference_index
      new Uint8Array(8), // reserved
      u16(channels),
      u16(16), // sample_size
      u16(0), u16(0), // pre_defined, reserved
      u32(sampleRate << 16), // 16.16 fixed point
      esds,
    ]));

    const stsd = fullBox("stsd", 0, 0, concat([u32(1), mp4a]));
    const stts = fullBox("stts", 0, 0, concat([u32(1), u32(chunks.length), u32(samplesPerFrame)]));
    const stsc = fullBox("stsc", 0, 0, concat([u32(1), u32(1), u32(chunks.length), u32(1)]));

    const stszPayload = new Uint8Array(8 + chunks.length * 4);
    const stszView = new DataView(stszPayload.buffer);
    stszView.setUint32(0, 0); // variable sample size
    stszView.setUint32(4, chunks.length);
    for (let i = 0; i < chunks.length; i++) {
      stszView.setUint32(8 + i * 4, chunks[i].byteLength);
    }
    const stsz = fullBox("stsz", 0, 0, stszPayload);
    const stco = fullBox("stco", 0, 0, concat([u32(1), u32(mdatDataOffset)]));

    const stbl = box("stbl", concat([stsd, stts, stsc, stsz, stco]));
    const minf = box("minf", concat([smhd, dinf, stbl]));
    const mdia = box("mdia", concat([mdhd, hdlr, minf]));
    const trak = box("trak", concat([tkhd, mdia]));
    return box("moov", concat([mvhd, trak]));
  };

  // Beregn eksakt posisjon til mdat-dataene ved å måle moov først (faststart).
  const probeMoov = buildMoov(0);
  const mdatDataOffset = ftyp.byteLength + probeMoov.byteLength + 8;
  const moov = buildMoov(mdatDataOffset);

  const mdatHeader = concat([u32(8 + totalMdatPayload), ascii("mdat")]);
  const totalSize = ftyp.byteLength + moov.byteLength + mdatHeader.byteLength + totalMdatPayload;
  const output = new Uint8Array(totalSize);
  let pos = 0;
  output.set(ftyp, pos); pos += ftyp.byteLength;
  output.set(moov, pos); pos += moov.byteLength;
  output.set(mdatHeader, pos); pos += mdatHeader.byteLength;
  for (const chunk of chunks) {
    output.set(chunk, pos);
    pos += chunk.byteLength;
  }
  return output.buffer;
}

/* ---------- Fallback: 22,05 kHz mono 16-bit WAV ---------- */

async function encodeCompactMonoWav(buffer: AudioBuffer): Promise<ArrayBuffer> {
  const sampleRate = 22050;
  const samples = await resampleToMono(buffer, sampleRate);
  const dataLength = samples.length * 2;
  const out = new ArrayBuffer(44 + dataLength);
  const view = new DataView(out);
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return out;
}

/* ---------- Binære hjelpere for ISO BMFF ---------- */

function ascii(str: string): Uint8Array {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i);
  return out;
}
function u16(value: number): Uint8Array {
  return new Uint8Array([(value >>> 8) & 0xff, value & 0xff]);
}
function u32(value: number): Uint8Array {
  return new Uint8Array([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
}
function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}
function box(type: string, payload: Uint8Array): Uint8Array {
  return concat([u32(8 + payload.byteLength), ascii(type), payload]);
}
function fullBox(type: string, version: number, flags: number, payload: Uint8Array): Uint8Array {
  const header = new Uint8Array([version & 0xff, (flags >>> 16) & 0xff, (flags >>> 8) & 0xff, flags & 0xff]);
  return box(type, concat([header, payload]));
}
function descriptor(tag: number, payload: Uint8Array): Uint8Array {
  // 1-byte eller multi-byte variabel lengde (ISO 14496-1)
  const len = payload.byteLength;
  const sizeBytes: number[] = [];
  if (len < 128) {
    sizeBytes.push(len);
  } else {
    sizeBytes.push(((len >> 7) & 0x7f) | 0x80, len & 0x7f);
  }
  return concat([new Uint8Array([tag, ...sizeBytes]), payload]);
}
