export interface ECGResult {
  id: number;
  patient_id: string;
  filename: string;
  flags: string[];
  confidence_scores: number[];
  overall_prediction: "normal" | "abnormal";
  created_at: string;
}

export interface UploadResponse {
  id: number;
  filename: string;
  patient_id: string;
  status: string;
  created_at: string;
}

export interface AiFinding {
  flag: string;
  confidence: number | null;
  explanation: string;
}

export interface AiReport {
  result_id: number;
  summary: string;
  urgency?: "routine" | "monitoring" | "expedited";
  findings?: AiFinding[];
  overall_interpretation?: string;
  recommendations: string[];
  limitations?: string[];
  disclaimer: string;
  generated_by: "ai" | "template";
}

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function uploadEcg(files: File[]): Promise<UploadResponse> {
  if (files.length === 0) throw new Error("No file selected");

  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file);
  }

  const res = await fetch(`${API_BASE}/api/upload`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail ?? `Upload failed (${res.status})`);
  }
  return res.json();
}

export async function getResult(id: number): Promise<ECGResult> {
  const res = await fetch(`${API_BASE}/api/results/${id}`);
  if (!res.ok) throw new Error(`Failed to fetch result ${id}`);
  return res.json();
}

export async function getHistory(limit = 20): Promise<ECGResult[]> {
  const res = await fetch(`${API_BASE}/api/results?limit=${limit}`);
  if (!res.ok) throw new Error("Failed to fetch history");
  return res.json();
}

export async function getAiReport(id: number): Promise<AiReport> {
  const res = await fetch(`${API_BASE}/api/results/${id}/report`);
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail ?? `Report generation failed (${res.status})`);
  }
  return res.json();
}

export function formatFlagName(flag: string): string {
  return flag
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
