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

export function uploadEpisode(data: FormData, onProgress: (percent: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/episodes");
    request.responseType = "json";
    request.upload.onprogress = ({ lengthComputable, loaded, total }) => {
      if (lengthComputable) onProgress(Math.round((loaded / total) * 100));
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error(request.response?.error || "Opplastingen mislyktes. Prøv igjen."));
    };
    request.onerror = () => reject(new Error("Forbindelsen ble brutt under opplastingen."));
    request.onabort = () => reject(new Error("Opplastingen ble avbrutt."));
    request.send(data);
  });
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
