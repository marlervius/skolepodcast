(() => {
  if (window.__lytteromNlmHooked) return;
  window.__lytteromNlmHooked = true;

  const capturedBlobs = new Map();
  let seq = 0;

  function notify(payload) {
    window.postMessage({ source: "lytterom-nlm-hook", ...payload }, "*");
  }

  // Fang opp lyd- og video-blobs når NotebookLM oppretter dem i minnet.
  const originalCreateObjectURL = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function (obj) {
    const url = originalCreateObjectURL(obj);
    try {
      if (obj instanceof Blob) {
        const mime = (obj.type || "").toLowerCase();
        const isMedia = mime.startsWith("audio/") || mime.startsWith("video/") || (mime === "" && obj.size > 150000);
        if (isMedia) {
          const id = `blob-${++seq}`;
          capturedBlobs.set(url, { id, blob: obj, mime: mime || "audio/wav", size: obj.size });
          notify({
            type: "MEDIA_CAPTURED",
            item: {
              id,
              url,
              kind: mime.startsWith("video/") ? "video" : "audio",
              mime: mime || "audio/wav",
              size: obj.size,
              label: mime.startsWith("video/") ? "Videooversikt fra NotebookLM" : "Lydoversikt fra NotebookLM",
            },
          });
        }
      }
    } catch {
      /* Ignorer feil slik at NotebookLM aldri forstyrres. */
    }
    return url;
  };

  // Fang opp når <audio> eller <video> starter eller laster en kilde.
  function inspectMediaElement(el) {
    const src = el.currentSrc || el.src;
    if (!src) return;
    const isVideo = el.tagName === "VIDEO";
    const existing = capturedBlobs.get(src);
    notify({
      type: "MEDIA_CAPTURED",
      item: {
        id: existing?.id || `el-${src.slice(-24)}`,
        url: src,
        kind: isVideo ? "video" : "audio",
        mime: existing?.mime || (isVideo ? "video/mp4" : "audio/wav"),
        size: existing?.size || 0,
        duration: Number.isFinite(el.duration) && el.duration > 0 ? Math.round(el.duration) : 0,
        label: isVideo ? "Video fra aktiv spiller" : "Podkast fra aktiv spiller",
      },
    });
  }

  document.addEventListener("loadedmetadata", (e) => {
    if (e.target instanceof HTMLMediaElement) inspectMediaElement(e.target);
  }, true);
  document.addEventListener("play", (e) => {
    if (e.target instanceof HTMLMediaElement) inspectMediaElement(e.target);
  }, true);

  // Svar når content.js ber om rådataene til en fanget blob-URL.
  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.data?.source !== "lytterom-nlm-content") return;

    if (event.data.type === "SCAN_MEDIA") {
      document.querySelectorAll("audio, video").forEach(inspectMediaElement);
      capturedBlobs.forEach((entry, url) => {
        notify({
          type: "MEDIA_CAPTURED",
          item: {
            id: entry.id,
            url,
            kind: entry.mime.startsWith("video/") ? "video" : "audio",
            mime: entry.mime,
            size: entry.size,
            label: entry.mime.startsWith("video/") ? "Videooversikt fra NotebookLM" : "Lydoversikt fra NotebookLM",
          },
        });
      });
      return;
    }

    if (event.data.type === "READ_MEDIA") {
      const { requestId, url } = event.data;
      try {
        let blob = capturedBlobs.get(url)?.blob;
        if (!blob) {
          const response = await fetch(url, { credentials: "include" });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          blob = await response.blob();
        }
        const buffer = await blob.arrayBuffer();
        window.postMessage(
          {
            source: "lytterom-nlm-hook",
            type: "READ_MEDIA_RESULT",
            requestId,
            ok: true,
            mime: blob.type || "audio/wav",
            buffer,
          },
          "*",
          [buffer],
        );
      } catch (err) {
        notify({
          type: "READ_MEDIA_RESULT",
          requestId,
          ok: false,
          error: err instanceof Error ? err.message : "Kunne ikke lese mediefilen fra siden.",
        });
      }
    }
  });
})();
