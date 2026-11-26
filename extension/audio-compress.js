/**
 * Nettleser-komprimering av WAV-lyd til M4A (AAC-LC) for Lytterom-utvidelsen.
 * Samme strategi som Lærerstudio: WebCodecs AAC → M4A med fallback til 22,05 kHz mono WAV.
 */
window.LytteromAudio = (() => {
  function isWav(filename, mime) {
    return /\.wav$/i.test(filename || "") || /audio\/(x-)?wav/i.test(mime || "");
  }

  function formatBytes(bytes) {
    if (!bytes) return "";
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
  }

  async function compressWavBuffer(arrayBuffer, filename, onStatus) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return { buffer: arrayBuffer, filename, mime: "audio/wav", compressed: false, durationSeconds: 0 };

    onStatus?.("Leser lydfil fra NotebookLM …");
    const ctx = new AudioCtx();
    let decoded;
    try {
      decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
    } finally {
      await ctx.close().catch(() => undefined);
    }

    const durationSeconds = Number.isFinite(decoded.duration) ? Math.round(decoded.duration) : 0;
    const base = filename.replace(/\.[^.]+$/, "");

    const m4a = await encodeAacM4a(decoded, onStatus).catch(() => null);
    if (m4a && m4a.byteLength < arrayBuffer.byteLength * 0.9) {
      return { buffer: m4a, filename: `${base}.m4a`, mime: "audio/mp4", compressed: true, durationSeconds };
    }

    onStatus?.("Optimaliserer WAV-lyd …");
    const monoWav = await encodeCompactMonoWav(decoded).catch(() => null);
    if (monoWav && monoWav.byteLength < arrayBuffer.byteLength * 0.85) {
      return { buffer: monoWav, filename: `${base}.wav`, mime: "audio/wav", compressed: true, durationSeconds };
    }

    return { buffer: arrayBuffer, filename, mime: "audio/wav", compressed: false, durationSeconds };
  }

  async function resampleToMono(buffer, targetSampleRate) {
    const length = Math.max(1, Math.ceil(buffer.duration * targetSampleRate));
    const offline = new OfflineAudioContext(1, length, targetSampleRate);
    const source = offline.createBufferSource();
    source.buffer = buffer;
    source.connect(offline.destination);
    source.start(0);
    const rendered = await offline.startRendering();
    return rendered.getChannelData(0);
  }

  async function encodeAacM4a(buffer, onStatus) {
    if (typeof AudioEncoder === "undefined" || typeof AudioData === "undefined") return null;
    const sampleRate = buffer.sampleRate === 48000 ? 48000 : 44100;
    const channels = 1;
    const bitrate = 96000;
    const config = { codec: "mp4a.40.2", sampleRate, numberOfChannels: channels, bitrate };
    const support = await AudioEncoder.isConfigSupported(config);
    if (!support.supported) return null;

    onStatus?.("Komprimerer podkast til M4A …");
    const monoPcm = await resampleToMono(buffer, sampleRate);
    const chunks = [];
    let asc = null;
    let encodeError = null;

    const encoder = new AudioEncoder({
      output(chunk, metadata) {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        chunks.push(data);
        if (!asc && metadata?.decoderConfig?.description) {
          const d = metadata.decoderConfig.description;
          asc = d instanceof ArrayBuffer ? new Uint8Array(d.slice(0)) : new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
        }
      },
      error(err) {
        encodeError = err;
      },
    });
    encoder.configure(config);

    const batchFrames = 1024 * 64;
    for (let offset = 0; offset < monoPcm.length; offset += batchFrames) {
      if (encodeError) throw encodeError;
      const slice = monoPcm.subarray(offset, Math.min(offset + batchFrames, monoPcm.length));
      const audioData = new AudioData({
        format: "f32-planar",
        sampleRate,
        numberOfFrames: slice.length,
        numberOfChannels: channels,
        timestamp: Math.round((offset / sampleRate) * 1000000),
        data: slice,
      });
      encoder.encode(audioData);
      audioData.close();
    }
    await encoder.flush();
    encoder.close();
    if (encodeError || !chunks.length) return null;

    if (!asc || asc.length < 2) {
      const rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
      const freqIndex = Math.max(0, rates.indexOf(sampleRate));
      asc = new Uint8Array([(2 << 3) | (freqIndex >> 1), ((freqIndex & 1) << 7) | (channels << 3)]);
    }

    return muxAacToM4a(chunks, sampleRate, channels, asc, bitrate);
  }

  function muxAacToM4a(chunks, sampleRate, channels, asc, bitrate) {
    const samplesPerFrame = 1024;
    const totalSamples = chunks.length * samplesPerFrame;
    const totalMdatPayload = chunks.reduce((s, c) => s + c.byteLength, 0);
    const ftyp = box("ftyp", concat([ascii("M4A "), u32(0), ascii("M4A "), ascii("mp42"), ascii("isom")]));

    const buildMoov = (mdatOffset) => {
      const mvhd = fullBox("mvhd", 0, 0, concat([
        u32(0), u32(0), u32(sampleRate), u32(totalSamples), u32(0x00010000), u16(0x0100), new Uint8Array(10),
        u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000),
        new Uint8Array(24), u32(2),
      ]));
      const tkhd = fullBox("tkhd", 0, 3, concat([
        u32(0), u32(0), u32(1), u32(0), u32(totalSamples), new Uint8Array(8), u16(0), u16(0), u16(0x0100), u16(0),
        u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000), u32(0), u32(0),
      ]));
      const mdhd = fullBox("mdhd", 0, 0, concat([u32(0), u32(0), u32(sampleRate), u32(totalSamples), u16(0x55c4), u16(0)]));
      const hdlr = fullBox("hdlr", 0, 0, concat([u32(0), ascii("soun"), new Uint8Array(12), ascii("SoundHandler\0")]));
      const smhd = fullBox("smhd", 0, 0, new Uint8Array(4));
      const dref = fullBox("dref", 0, 0, concat([u32(1), fullBox("url ", 0, 1, new Uint8Array(0))]));
      const dinf = box("dinf", dref);
      const decSpecific = descriptor(0x05, asc);
      const decConfig = descriptor(0x04, concat([new Uint8Array([0x40, 0x15, 0, 0, 0]), u32(bitrate), u32(bitrate), decSpecific]));
      const esds = fullBox("esds", 0, 0, descriptor(0x03, concat([u16(1), new Uint8Array([0]), decConfig, descriptor(0x06, new Uint8Array([2]))])));
      const mp4a = box("mp4a", concat([new Uint8Array(6), u16(1), new Uint8Array(8), u16(channels), u16(16), u16(0), u16(0), u32(sampleRate << 16), esds]));
      const stsd = fullBox("stsd", 0, 0, concat([u32(1), mp4a]));
      const stts = fullBox("stts", 0, 0, concat([u32(1), u32(chunks.length), u32(samplesPerFrame)]));
      const stsc = fullBox("stsc", 0, 0, concat([u32(1), u32(1), u32(chunks.length), u32(1)]));
      const stszPayload = new Uint8Array(8 + chunks.length * 4);
      const v = new DataView(stszPayload.buffer);
      v.setUint32(0, 0);
      v.setUint32(4, chunks.length);
      for (let i = 0; i < chunks.length; i++) v.setUint32(8 + i * 4, chunks[i].byteLength);
      const stsz = fullBox("stsz", 0, 0, stszPayload);
      const stco = fullBox("stco", 0, 0, concat([u32(1), u32(mdatOffset)]));
      return box("moov", concat([mvhd, box("trak", concat([tkhd, box("mdia", concat([mdhd, hdlr, box("minf", concat([smhd, dinf, box("stbl", concat([stsd, stts, stsc, stsz, stco]))]))]))]))]));
    };

    const probe = buildMoov(0);
    const moov = buildMoov(ftyp.byteLength + probe.byteLength + 8);
    const mdatHeader = concat([u32(8 + totalMdatPayload), ascii("mdat")]);
    const out = new Uint8Array(ftyp.byteLength + moov.byteLength + mdatHeader.byteLength + totalMdatPayload);
    let pos = 0;
    out.set(ftyp, pos); pos += ftyp.byteLength;
    out.set(moov, pos); pos += moov.byteLength;
    out.set(mdatHeader, pos); pos += mdatHeader.byteLength;
    for (const chunk of chunks) { out.set(chunk, pos); pos += chunk.byteLength; }
    return out.buffer;
  }

  async function encodeCompactMonoWav(buffer) {
    const sampleRate = 22050;
    const samples = await resampleToMono(buffer, sampleRate);
    const dataLength = samples.length * 2;
    const out = new ArrayBuffer(44 + dataLength);
    const view = new DataView(out);
    const w = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
    w(0, "RIFF"); view.setUint32(4, 36 + dataLength, true); w(8, "WAVE"); w(12, "fmt ");
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); w(36, "data"); view.setUint32(40, dataLength, true);
    let offset = 44;
    for (let i = 0; i < samples.length; i++, offset += 2) {
      const c = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, c < 0 ? c * 0x8000 : c * 0x7fff, true);
    }
    return out;
  }

  function ascii(s) { const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
  function u16(n) { return new Uint8Array([(n >>> 8) & 255, n & 255]); }
  function u32(n) { return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]); }
  function concat(parts) { const o = new Uint8Array(parts.reduce((s, p) => s + p.byteLength, 0)); let p = 0; for (const x of parts) { o.set(x, p); p += x.byteLength; } return o; }
  function box(type, payload) { return concat([u32(8 + payload.byteLength), ascii(type), payload]); }
  function fullBox(type, v, f, payload) { return box(type, concat([new Uint8Array([v & 255, (f >>> 16) & 255, (f >>> 8) & 255, f & 255]), payload])); }
  function descriptor(tag, payload) {
    const len = payload.byteLength;
    const size = len < 128 ? [len] : [((len >> 7) & 0x7f) | 0x80, len & 0x7f];
    return concat([new Uint8Array([tag, ...size]), payload]);
  }

  return { isWav, formatBytes, compressWavBuffer };
})();
