"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2,
  RefreshCw,
  AlertCircle,
  Activity,
  Ruler,
  Stethoscope,
  FileDown,
  ChevronDown,
  ChevronUp,
  ListChecks,
} from "lucide-react";
import type { ClinicalReport, ECGResult } from "@/lib/api";
import { getClinicalReport, downloadReportPdf } from "@/lib/api";

// ── Measurement formatting ─────────────────────────────────────

const NARRATIVE_SECTIONS: { key: keyof ClinicalReport["narrative"]; title: string }[] = [
  { key: "clinical_presentation", title: "Clinical Presentation" },
  { key: "ecg_findings", title: "ECG Findings" },
  { key: "diagnosis", title: "Diagnosis" },
  { key: "interpretation", title: "Interpretation" },
  { key: "key_teaching_points", title: "Key Teaching Points" },
];

const SUPERCLASS_ORDER = ["NORM", "MI", "STTC", "CD", "HYP"];

const CLASS_LABEL: Record<string, string> = {
  NORM: "Normal ECG",
  MI: "Myocardial infarction",
  STTC: "ST/T-segment change",
  CD: "Conduction disturbance",
  HYP: "Hypertrophy",
};

function val(v: number | null | undefined, unit = ""): string {
  return v == null ? "unavailable" : `${v}${unit}`;
}

// ── Measurements table ─────────────────────────────────────────

function MeasurementsTable({ report }: { report: ClinicalReport }) {
  const e = report.case.ecg;
  const rows: { label: string; value: string; available: boolean }[] = [
    { label: "Rhythm", value: e.rhythm ?? "not determinable", available: !!e.rhythm },
    { label: "Heart rate", value: val(e.heart_rate, " bpm"), available: e.heart_rate != null },
    { label: "PR interval", value: val(e.pr, " ms"), available: e.pr != null },
    { label: "QRS duration", value: val(e.qrs, " ms"), available: e.qrs != null },
    {
      label: "QT / QTc",
      value: `${val(e.qt, " ms")} / ${val(e.qtc, " ms")}`,
      available: e.qt != null || e.qtc != null,
    },
    { label: "QRS axis", value: e.qrs_axis ?? "unavailable", available: !!e.qrs_axis },
    {
      label: "P / T axis",
      value: `${e.p_axis ?? "unavailable"} / ${e.t_axis ?? "unavailable"}`,
      available: !!e.p_axis || !!e.t_axis,
    },
  ];

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-black/70">
        <Ruler className="h-3.5 w-3.5" />
        Measurements
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-4">
        {rows.map((r) => (
          <div
            key={r.label}
            className="flex items-baseline justify-between gap-2 border-b border-black/10 py-1.5"
          >
            <dt className="shrink-0 text-xs text-black/70">{r.label}</dt>
            <dd
              className={`text-right text-xs font-semibold tabular-nums ${
                r.available ? "text-black" : "italic text-black/50"
              }`}
            >
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-1.5 text-[10px] italic text-black/60">
        Values reported as unavailable were not computable from the recording and were
        deliberately not filled in.
      </p>
    </div>
  );
}

// ── Category score bars ────────────────────────────────────────

function CategoryScores({ report }: { report: ClinicalReport }) {
  const probs = report.case.class_probabilities;
  const thresholds = report.case.thresholds;

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-black/70">
        <Activity className="h-3.5 w-3.5" />
        Diagnostic Category Scores
      </div>
      <div className="mt-2 space-y-2">
        {SUPERCLASS_ORDER.map((s, i) => {
          const p = probs[s] ?? 0;
          const t = thresholds[s] ?? 0.5;
          const flagged = p >= t;
          return (
            <motion.div
              key={s}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.06 }}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className={`text-xs font-medium ${flagged ? "text-black" : "text-black/70"}`}>
                  {CLASS_LABEL[s]}
                </span>
                <span
                  className={`text-xs font-bold tabular-nums ${
                    flagged ? "text-brand" : "text-black/60"
                  }`}
                >
                  {Math.round(p * 100)}%
                </span>
              </div>
              <div className="relative mt-1 h-1.5 overflow-hidden rounded-full bg-black/10">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(p, 1) * 100}%` }}
                  transition={{ duration: 0.6, delay: i * 0.06 + 0.15 }}
                  className={`h-full rounded-full ${
                    flagged ? "bg-brand" : "bg-black/40"
                  }`}
                />
                {/* reporting-threshold marker */}
                <div
                  className="absolute top-[-2px] h-[10px] w-px bg-black/60"
                  style={{ left: `${Math.min(t, 1) * 100}%` }}
                  title={`reporting threshold ${Math.round(t * 100)}%`}
                />
              </div>
            </motion.div>
          );
        })}
      </div>
      <p className="mt-1.5 text-[10px] italic text-black/60">
        Five categories scored independently; the tick marks the reporting threshold.
      </p>
    </div>
  );
}

// ── Findings / diagnosis lists ─────────────────────────────────

function BulletList({ items = [], icon: Icon, title }: {
  items?: string[];
  icon: typeof ListChecks;
  title: string;
}) {
  const safeItems = Array.isArray(items) ? items : [];
  if (safeItems.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-black/70">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </div>
      <ul className="mt-2 space-y-1.5">
        {safeItems.map((item, i) => (
          <motion.li
            key={i}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.08 * i }}
            className="flex items-start gap-2 rounded-lg bg-white p-2 text-[13px] leading-snug text-black ring-1 ring-black/10"
          >
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand" />
            {item}
          </motion.li>
        ))}
      </ul>
    </div>
  );
}

// ── Narrative ──────────────────────────────────────────────────

function Narrative({ report }: { report: ClinicalReport }) {
  const [expanded, setExpanded] = useState(false);
  const sections = NARRATIVE_SECTIONS.filter((s) => report.narrative[s.key]?.trim());
  if (sections.length === 0) return null;

  // First two sections always visible; the rest behind a toggle.
  const head = sections.slice(0, 2);
  const tail = sections.slice(2);

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-black/70">
        <Stethoscope className="h-3.5 w-3.5" />
        Interpretive Report
      </div>
      <div className="mt-2 space-y-3">
        {head.map((s) => (
          <div key={s.key}>
            <p className="text-xs font-bold text-black">{s.title}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-black/80">
              {report.narrative[s.key]}
            </p>
          </div>
        ))}
      </div>
      {tail.length > 0 && (
        <>
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-brand transition-colors hover:text-black"
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded ? "Show less" : `Show ${tail.length} more section${tail.length > 1 ? "s" : ""}`}
          </button>
          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="overflow-hidden"
              >
                <div className="mt-2 space-y-3">
                  {tail.map((s) => (
                    <div key={s.key}>
                      <p className="text-xs font-bold text-black">{s.title}</p>
                      <p className="mt-1 text-[13px] leading-relaxed text-black/80">
                        {report.narrative[s.key]}
                      </p>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────

export default function ClinicalSummary({ result }: { result: ECGResult }) {
  const [report, setReport] = useState<ClinicalReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generatedFor = useRef<number | null>(null);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const rep = await getClinicalReport(result.id);
      setReport(rep);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Report failed");
    } finally {
      setLoading(false);
    }
  }, [result.id]);

  useEffect(() => {
    if (generatedFor.current === result.id) return;
    generatedFor.current = result.id;
    void generate();
  }, [result.id, generate]);

  const downloadPdf = useCallback(async () => {
    setDownloading(true);
    setError(null);
    try {
      await downloadReportPdf(result.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "PDF download failed");
    } finally {
      setDownloading(false);
    }
  }, [result.id]);

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.15, ease: "easeOut" }}
      className="rounded-xl border border-black/10 bg-white shadow-sm"
    >
      {/* Header — title + PDF download */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/10 px-5 py-3">
        <div>
          <h2 className="font-display text-sm font-bold text-black">
            Clinical Report
          </h2>
          <p className="text-[11px] text-black/60">
            {report
              ? `Report CL-${result.id} · ${
                  report.generated_by === "ai" ? "AI-assisted" : "Template"
                } · every number traced to the structured case`
              : "Auto-generated on upload"}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {loading && (
            <span className="flex items-center gap-1.5 text-xs text-brand">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Generating…
            </span>
          )}
          {!loading && report && (
            <button
              onClick={() => void downloadPdf()}
              disabled={downloading}
              className="flex items-center gap-1.5 rounded-lg bg-black px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-brand disabled:opacity-60"
              title="Download the one-page PDF of this report"
            >
              {downloading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileDown className="h-3.5 w-3.5" />
              )}
              {downloading ? "Preparing…" : "Download PDF"}
            </button>
          )}
          {!loading && !report && error && (
            <span className="flex items-center gap-1 text-[11px] text-red-600">
              <AlertCircle className="h-3.5 w-3.5" />
              Failed
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="p-5">
        {/* Loading shimmer */}
        <AnimatePresence>
          {loading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-3"
            >
              {[0, 1, 2, 3].map((i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0.3 }}
                  animate={{ opacity: [0.3, 0.7, 0.3] }}
                  transition={{ repeat: Infinity, duration: 1.4, delay: i * 0.15 }}
                  className="h-3 rounded-full bg-black/10"
                  style={{ width: `${90 - i * 12}%` }}
                />
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error */}
        {error && !loading && (
          <div className="flex items-center justify-between rounded-lg bg-red-50 px-3 py-2.5">
            <p className="flex items-center gap-2 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </p>
            <button
              onClick={() => void generate()}
              className="flex items-center gap-1 rounded-lg bg-black px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-brand"
            >
              <RefreshCw className="h-3 w-3" />
              Retry
            </button>
          </div>
        )}

        {/* Report content */}
        <AnimatePresence>
          {report && !loading && (
            <motion.div
              key="report"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
              className="space-y-5"
            >
              <MeasurementsTable report={report} />
              <BulletList
                items={report.case.findings}
                icon={AlertCircle}
                title="Findings"
              />
              <BulletList
                items={report.case.diagnosis}
                icon={Stethoscope}
                title="Diagnosis"
              />
              <CategoryScores report={report} />
              <Narrative report={report} />

              {/* Footer */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-black/10 pt-3">
                <p className="max-w-[75%] text-[10px] italic leading-relaxed text-black/60">
                  {report.disclaimer}
                </p>
                <div className="flex items-center gap-1.5">
                  {report.generated_by === "template" && (
                    <span className="rounded bg-black/10 px-2 py-0.5 text-[10px] text-black/70">
                      Template mode
                    </span>
                  )}
                  {report.guardrail.violations.length === 0 ? (
                    <span className="rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
                      Numbers verified
                    </span>
                  ) : (
                    <span className="rounded bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600">
                      Guardrail fallback
                    </span>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.section>
  );
}
