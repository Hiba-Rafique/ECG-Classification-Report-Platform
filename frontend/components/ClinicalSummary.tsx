"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  Loader2,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Eye,
  Siren,
  ChevronDown,
  ChevronUp,
  BookOpen,
  ListChecks,
} from "lucide-react";
import type { AiReport, ECGResult } from "@/lib/api";
import { formatFlagName } from "@/lib/api";

// ── Urgency config ────────────────────────────────────────────

const URGENCY: Record<
  NonNullable<AiReport["urgency"]>,
  { label: string; icon: typeof Eye; bg: string; ring: string; dot: string }
> = {
  routine: {
    label: "Routine",
    icon: CheckCircle2,
    bg: "bg-emerald-50",
    ring: "ring-emerald-200",
    dot: "bg-emerald-500",
  },
  monitoring: {
    label: "Monitor",
    icon: Eye,
    bg: "bg-amber-50",
    ring: "ring-amber-200",
    dot: "bg-amber-500",
  },
  expedited: {
    label: "Review Now",
    icon: Siren,
    bg: "bg-red-50",
    ring: "ring-red-200",
    dot: "bg-red-500",
  },
};

function confColor(c: number | null): string {
  if (c == null) return "text-slate-500";
  if (c >= 0.5) return "text-medical-600";
  if (c >= 0.25) return "text-amber-600";
  return "text-slate-400";
}

function confBarColor(c: number | null): string {
  if (c == null) return "bg-slate-200";
  if (c >= 0.5) return "bg-medical-500";
  if (c >= 0.25) return "bg-amber-400";
  return "bg-slate-300";
}

// ── Report body (shown after data loads) ──────────────────────

function ReportBody({ report }: { report: AiReport }) {
  const findings = report.findings ?? [];
  const urgency = report.urgency ? URGENCY[report.urgency] : null;
  const UrgencyIcon = urgency?.icon;
  const [expanded, setExpanded] = useState(false);
  const [interpExpanded, setInterpExpanded] = useState(false);

  return (
    <div className="space-y-4">
      {/* ── Bottom line ───────────────────────────── */}
      <div className="rounded-xl bg-slate-50 p-4">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm leading-relaxed text-slate-700">
            {report.summary}
          </p>
          {urgency && UrgencyIcon && (
            <span
              className={`flex shrink-0 items-center gap-1.5 rounded-lg ring-1 ${urgency.bg} ${urgency.ring} px-3 py-1.5 text-xs font-bold uppercase tracking-wide`}
            >
              <span className={`h-2 w-2 rounded-full ${urgency.dot} animate-pulse`} />
              {urgency.label}
            </span>
          )}
        </div>
      </div>

      {/* ── Findings ──────────────────────────────── */}
      {findings.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">
            <AlertCircle className="h-3.5 w-3.5" />
            Key Findings
          </div>
          <div className="mt-2 space-y-2">
            {findings.map((f, i) => (
              <motion.div
                key={`${f.flag}-${i}`}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.08 }}
                className="group rounded-lg border border-slate-100 bg-white p-3 transition-shadow hover:shadow-md"
              >
                <div className="flex items-center gap-3">
                  {/* Confidence bar */}
                  <div className="w-12 shrink-0 text-right">
                    <span className={`text-sm font-bold tabular-nums ${confColor(f.confidence)}`}>
                      {f.confidence != null ? `${Math.round(f.confidence * 100)}%` : "—"}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-800">
                        {formatFlagName(f.flag)}
                      </span>
                    </div>
                    {/* Micro confidence bar */}
                    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-100">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{
                          width: f.confidence != null ? `${f.confidence * 100}%` : "0%",
                        }}
                        transition={{ duration: 0.6, delay: i * 0.08 + 0.2 }}
                        className={`h-full rounded-full ${confBarColor(f.confidence)}`}
                      />
                    </div>
                  </div>
                </div>
                {f.explanation && (
                  <p className="mt-2 pl-15 text-[13px] leading-relaxed text-slate-500">
                    {f.explanation}
                  </p>
                )}
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* ── Actions ────────────────────────────────── */}
      {report.recommendations.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">
            <ListChecks className="h-3.5 w-3.5" />
            Clinical Actions
          </div>
          <ol className="mt-2 space-y-1.5">
            {report.recommendations.map((rec, i) => (
              <motion.li
                key={i}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 + i * 0.06 }}
                className="flex items-start gap-3 rounded-lg bg-white p-2.5 text-sm leading-snug text-slate-700"
              >
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-medical-100 text-[10px] font-bold text-medical-700">
                  {i + 1}
                </span>
                {rec}
              </motion.li>
            ))}
          </ol>
        </div>
      )}

      {/* ── Interpretation (collapsible) ───────────── */}
      {report.overall_interpretation && (
        <div>
          <button
            onClick={() => setInterpExpanded(!interpExpanded)}
            className="flex w-full items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400 transition-colors hover:text-slate-600"
          >
            {interpExpanded ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
            Interpretation
          </button>
          <AnimatePresence>
            {interpExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <p className="mt-2 rounded-lg bg-slate-50 p-3 text-sm leading-relaxed text-slate-600">
                  {report.overall_interpretation}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* ── Guideline references ──────────────────── */}
      {report.guideline_references && report.guideline_references.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50 p-2.5">
          <BookOpen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500" />
          <div className="text-[11px] leading-relaxed text-blue-700">
            <span className="font-semibold">Guidelines applied: </span>
            {report.guideline_references.join(" · ")}
          </div>
        </div>
      )}

      {/* ── Expandable limitations ────────────────── */}
      {(report.limitations?.length ?? 0) > 0 && (
        <div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex w-full items-center gap-2 text-[11px] text-slate-400 transition-colors hover:text-slate-600"
          >
            {expanded ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
            {report.limitations!.length} limitation{report.limitations!.length > 1 ? "s" : ""}
          </button>
          <AnimatePresence>
            {expanded && (
              <motion.ul
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="mt-1 space-y-1 overflow-hidden"
              >
                {report.limitations!.map((lim, i) => (
                  <li key={i} className="text-[11px] leading-relaxed text-slate-400">
                    • {lim}
                  </li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* ── Footer ────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <p className="text-[10px] italic text-slate-400">{report.disclaimer}</p>
        {report.generated_by === "template" && (
          <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] text-slate-400">
            Template mode
          </span>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────

export default function ClinicalSummary({ result }: { result: ECGResult }) {
  const [report, setReport] = useState<AiReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generatedFor = useRef<number | null>(null);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const { getAiReport } = await import("@/lib/api");
      const rep = await getAiReport(result.id);
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

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.15, ease: "easeOut" }}
      className="rounded-2xl border border-medical-100 bg-white shadow-lg shadow-medical-100/30"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-medical-500 to-medical-700 text-white shadow-sm">
            <Sparkles className="h-4 w-4" />
          </span>
          <div>
            <h2 className="font-display text-sm font-bold text-slate-900">
              Clinical Summary
            </h2>
            <p className="text-[11px] text-slate-400">
              AI-assisted · auto-generated
            </p>
          </div>
        </div>

        {loading ? (
          <span className="flex items-center gap-1.5 text-xs text-medical-600">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Generating…
          </span>
        ) : report ? (
          <span className="flex items-center gap-1 text-[11px] text-emerald-600">
            <CheckCircle2 className="h-3 w-3" />
            Ready
          </span>
        ) : null}
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
                  transition={{
                    repeat: Infinity,
                    duration: 1.4,
                    delay: i * 0.15,
                  }}
                  className="h-3 rounded-full bg-slate-100"
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
              className="flex items-center gap-1 rounded-lg bg-medical-600 px-3 py-1 text-xs font-semibold text-white hover:bg-medical-700"
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
            >
              <ReportBody report={report} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.section>
  );
}
