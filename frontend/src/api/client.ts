export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

export type HealthResponse = {
  status: string;
  app: string;
  model: string;
  model_available: boolean;
  model_status: "ready" | "api_key_missing" | "unreachable" | string;
  model_error: string | null;
  database: string;
  storage: string;
};

export type Trip = {
  id: number;
  title: string;
  description: string | null;
  cover_photo_id: number | null;
  created_at: string;
};

export type MemorableMoment = {
  title: string;
  description: string;
  evidence_photo_ids: number[];
};

export type TripMemory = {
  trip_id: number;
  narrative_summary: string;
  inferred_interests: string[];
  recurring_themes: string[];
  memorable_moments: MemorableMoment[];
  evidence_photo_ids: number[];
  uncertainty_notes: string[];
  raw_model_json: Record<string, unknown>;
  user_narrative_summary: string | null;
  user_note: string | null;
  prompt_version: string;
  created_at: string;
  updated_at: string;
};

export type PhotoAnalysis = {
  photo_id: number;
  scene: string;
  activities: string[];
  objects: string[];
  mood: string;
  memory_prompt: string;
  confidence: number;
  raw_model_json: Record<string, unknown>;
  user_memory_caption: string | null;
  user_scene_summary: string | null;
  user_mood: string | null;
  user_note: string | null;
  updated_at: string | null;
  scene_summary: string;
  memory_caption: string;
  place_type: string;
  visible_activities: string[];
  visible_objects: string[];
  sensory_details: string[];
  inferred_interest_signals: string[];
  uncertainty_notes: string[];
};

export type Photo = {
  id: number;
  trip_id: number;
  filename: string;
  stored_path: string;
  image_url: string;
  content_sha256: string | null;
  byte_size: number | null;
  mime_type: string | null;
  captured_at: string | null;
  latitude: number | null;
  longitude: number | null;
  exif_json: Record<string, unknown>;
  is_favorite: boolean;
  created_at: string;
  analysis: PhotoAnalysis | null;
};

export type TripQuestion = {
  id: number;
  trip_id: number;
  question: string;
  answer: string;
  evidence_photo_ids: number[];
  created_at: string;
};

export type TripDetail = Trip & {
  photos: Photo[];
  memory: TripMemory | null;
  questions: TripQuestion[];
};

export type AskResponse = {
  answer: string;
  evidence_photo_ids: number[];
};

export type AnalysisJob = {
  id: number;
  trip_id: number;
  status:
    | "queued"
    | "running"
    | "cancel_requested"
    | "canceled"
    | "completed"
    | "failed";
  current_step: string;
  completed_steps: number;
  total_steps: number;
  mode: "all" | "missing";
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type AnalyzeMode = "all" | "missing";

export type PhotoImportResult = {
  filename: string;
  status: "stored" | "duplicate" | "rejected";
  detail: string | null;
  photo: Photo | null;
};

export type PhotoImportResponse = {
  results: PhotoImportResult[];
  stored_count: number;
  duplicate_count: number;
  rejected_count: number;
};

export async function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>("/api/health");
}

export async function listTrips(): Promise<Trip[]> {
  return request<Trip[]>("/api/trips");
}

export async function getTrip(tripId: number): Promise<TripDetail> {
  return request<TripDetail>(`/api/trips/${tripId}`);
}

export async function getLatestTripJob(
  tripId: number
): Promise<AnalysisJob | null> {
  return request<AnalysisJob | null>(`/api/trips/${tripId}/jobs/latest`);
}

export async function createTrip(payload: {
  title: string;
  description?: string | null;
}): Promise<Trip> {
  return request<Trip>("/api/trips", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function updateTrip(
  tripId: number,
  payload: {
    title?: string;
    description?: string | null;
    cover_photo_id?: number | null;
  }
): Promise<Trip> {
  return request<Trip>(`/api/trips/${tripId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function uploadPhotos(
  tripId: number,
  files: FileList | File[]
): Promise<Photo[]> {
  const formData = new FormData();
  Array.from(files).forEach((file) => formData.append("files", file));
  return request<Photo[]>(`/api/trips/${tripId}/photos`, {
    method: "POST",
    body: formData
  });
}

export async function importPhotos(
  tripId: number,
  files: FileList | File[]
): Promise<PhotoImportResponse> {
  const formData = new FormData();
  Array.from(files).forEach((file) => formData.append("files", file));
  return request<PhotoImportResponse>(`/api/trips/${tripId}/photos/import`, {
    method: "POST",
    body: formData
  });
}

export async function analyzeTrip(
  tripId: number,
  mode: AnalyzeMode = "all"
): Promise<AnalysisJob> {
  return request<AnalysisJob>(`/api/trips/${tripId}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode })
  });
}

export async function getJob(jobId: number): Promise<AnalysisJob> {
  return request<AnalysisJob>(`/api/jobs/${jobId}`);
}

export async function cancelJob(jobId: number): Promise<AnalysisJob> {
  return request<AnalysisJob>(`/api/jobs/${jobId}/cancel`, { method: "POST" });
}

export async function retryJob(jobId: number): Promise<AnalysisJob> {
  return request<AnalysisJob>(`/api/jobs/${jobId}/retry`, { method: "POST" });
}

export async function askTrip(
  tripId: number,
  question: string
): Promise<AskResponse> {
  return request<AskResponse>(`/api/trips/${tripId}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question })
  });
}

export async function updatePhoto(
  photoId: number,
  payload: {
    is_favorite?: boolean;
    user_memory_caption?: string | null;
    user_scene_summary?: string | null;
    user_mood?: string | null;
    user_note?: string | null;
  }
): Promise<Photo> {
  return request<Photo>(`/api/photos/${photoId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function updateTripMemory(
  tripId: number,
  payload: {
    user_narrative_summary?: string | null;
    user_note?: string | null;
  }
): Promise<TripMemory> {
  return request<TripMemory>(`/api/trips/${tripId}/memory`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function deleteTrip(tripId: number): Promise<void> {
  await requestNoContent(`/api/trips/${tripId}`, { method: "DELETE" });
}

export async function deletePhoto(photoId: number): Promise<void> {
  await requestNoContent(`/api/photos/${photoId}`, { method: "DELETE" });
}

export async function clearTripAnalysis(tripId: number): Promise<void> {
  await requestNoContent(`/api/trips/${tripId}/analysis`, { method: "DELETE" });
}

export async function exportTripMarkdown(
  tripId: number
): Promise<{ filename: string; content: string }> {
  const response = await fetch(`${API_BASE_URL}/api/trips/${tripId}/export.md`);
  if (!response.ok) {
    throw await responseError(response);
  }
  return {
    filename: attachmentFilename(response.headers.get("content-disposition")),
    content: await response.text()
  };
}

export async function exportTripZip(
  tripId: number
): Promise<{ filename: string; blob: Blob }> {
  const response = await fetch(`${API_BASE_URL}/api/trips/${tripId}/export.zip`);
  if (!response.ok) {
    throw await responseError(response);
  }
  return {
    filename: attachmentFilename(response.headers.get("content-disposition")),
    blob: await response.blob()
  };
}

export function assetUrl(path: string): string {
  if (path.startsWith("http")) {
    return path;
  }
  return `${API_BASE_URL}${path}`;
}

function attachmentFilename(value: string | null): string {
  const match = value?.match(/filename="([^"]+)"/);
  return match?.[1] ?? "trip-memory.md";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, init);
  if (!response.ok) {
    throw await responseError(response);
  }
  return response.json() as Promise<T>;
}

async function requestNoContent(path: string, init?: RequestInit): Promise<void> {
  const response = await fetch(`${API_BASE_URL}${path}`, init);
  if (!response.ok) {
    throw await responseError(response);
  }
}

async function responseError(response: Response): Promise<Error> {
  const text = await response.text();
  if (!text) {
    return new Error(response.statusText || `Request failed with ${response.status}`);
  }

  try {
    const payload = JSON.parse(text) as { detail?: unknown };
    if (typeof payload.detail === "string") {
      return new Error(payload.detail);
    }
    if (Array.isArray(payload.detail)) {
      const messages = payload.detail
        .map((item) => {
          if (item && typeof item === "object" && "msg" in item) {
            return String((item as { msg: unknown }).msg);
          }
          return String(item);
        })
        .filter(Boolean);
      if (messages.length > 0) {
        return new Error(messages.join("; "));
      }
    }
  } catch {
    // Plain-text error responses are displayed as-is.
  }

  return new Error(text);
}
