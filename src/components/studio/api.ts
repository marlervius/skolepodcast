export async function studioRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...options,
  });
  if (response.status === 204) return undefined as T;
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(result?.error || "Forespørselen mislyktes. Prøv igjen.");
  }
  return result as T;
}

export function studioJson(method: "POST" | "PATCH", data: object): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  };
}

type UploadTicket = { upload_url: string; upload_path: string; content_type: string };

/**
 * Laster opp en fil direkte til Supabase Storage og lager episoden etterpå.
 * Serveren gir en tidsbegrenset opplastingslenke, så filen aldri går gjennom Vercel.
 */
export async function uploadEpisode(file: File, fields: Record<string, unknown>, onProgress: (percent: number) => void) {
  const ticket = await studioRequest<UploadTicket>("/api/uploads", studioJson("POST", {
    course_id: fields.course_id, filename: file.name, size: file.size,
  }));
  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", ticket.upload_url);
    request.setRequestHeader("Content-Type", ticket.content_type);
    request.setRequestHeader("Cache-Control", "max-age=31536000");
    request.setRequestHeader("x-upsert", "false");
    request.upload.onprogress = ({ lengthComputable, loaded, total }) => {
      if (lengthComputable) onProgress(Math.round((loaded / total) * 100));
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else if (request.status === 413) reject(new Error("Filen er for stor for lagringen."));
      else reject(new Error("Opplastingen mislyktes. Prøv igjen."));
    };
    request.onerror = () => reject(new Error("Forbindelsen ble brutt under opplastingen."));
    request.onabort = () => reject(new Error("Opplastingen ble avbrutt."));
    request.send(file);
  });
  await studioRequest("/api/episodes", studioJson("POST", { ...fields, upload_path: ticket.upload_path }));
}

export function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "Noe gikk galt. Prøv igjen.";
}

export function durationLabel(seconds: number) {
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const remainder = String(total % 60).padStart(2, "0");
  if (hours) return `${hours}:${String(minutes).padStart(2, "0")}:${remainder}`;
  return `${minutes}:${remainder}`;
}
