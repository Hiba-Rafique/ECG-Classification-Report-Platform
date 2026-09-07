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

export interface ECGSignal {
  fs: number;              // original recording rate (Hz)
  signal_fs: number;       // rate of the samples in this payload
  duration_s: number;
  units: string;           // "mV"
  lead_names: string[];    // 12 canonical lead names
  leads: number[][];       // one sample array (mV) per lead
}

export interface EcgMeasurements {
  heart_rate: number | null;
  rhythm: string | null;
  pr: number | null;
  qrs: number | null;
  qt: number | null;
  qtc: number | null;
  qrs_axis: string | null;
  p_axis: string | null;
  t_axis: string | null;
}

export interface ClinicalCase {
  case_id: string;
  recording: {
    filename: string;
    patient_id: string;
    duration: string;
  };
  ecg: EcgMeasurements;
  findings: string[];
  diagnosis: string[];
  class_probabilities: Record<string, number>;
  thresholds: Record<string, number>;
}

export interface ClinicalReport {
  result_id: number;
  generated_at: string;
  generated_by: "ai" | "template";
  guardrail: { violations: string[] };
  case: ClinicalCase;
  narrative: {
    clinical_presentation: string;
    ecg_findings: string;
    diagnosis: string;
    interpretation: string;
    key_teaching_points: string;
  };
  disclaimer: string;
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

export async function getSignal(id: number): Promise<ECGSignal> {
  const res = await fetch(`${API_BASE}/api/results/${id}/signal`);
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail ?? `Signal fetch failed (${res.status})`);
  }
  return res.json();
}

export async function getClinicalReport(id: number): Promise<ClinicalReport> {
  const res = await fetch(`${API_BASE}/api/results/${id}/report`);
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail ?? `Report generation failed (${res.status})`);
  }
  return res.json();
}

export async function downloadReportPdf(id: number): Promise<void> {
  // The backend renders the PDF of the SAME cached report the user is
  // looking at — fetch it as a blob and trigger a browser download.
  const res = await fetch(`${API_BASE}/api/results/${id}/report/pdf`);
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail ?? `PDF generation failed (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `clinical_report_${id}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Readable names for the five diagnostic superclasses (NORM/MI/STTC/CD/HYP)
const FLAG_READABLE: Record<string, string> = {
  NORM: "Normal ECG",
  MI: "Myocardial Infarction",
  STTC: "ST/T Change",
  CD: "Conduction Disturbance",
  HYP: "Hypertrophy",
};

export function formatFlagName(flag: string): string {
  if (FLAG_READABLE[flag]) return FLAG_READABLE[flag];
  return flag
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
