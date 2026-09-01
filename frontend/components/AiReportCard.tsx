"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  Loader2,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Eye,
  Siren,
  Info,
} from "lucide-react";
import type { AiReport, ECGResult } from "@/lib/api";
import { formatFlagName } from "@/lib/api";

const URGENCY_STYLES: Record<
  NonNullable<AiReport["urgency"]>,
  { icon: typeof Eye; label: string; className: string }
> = {
  routine: {
    icon: CheckCircle2,
    label: "Routine",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  monitoring: {
    icon: Eye,
    label: "Monitoring",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  expedited: {
    icon: Siren,
    label: "Expedited review",
    className: "border-medical-200 bg-medical-50 text-medical-700",
  },
};

function ConfidenceChip({ confidence }: { confidence: number | null }) {
  if (confidence == null) return null;
  const pct = Math.round(confidence * 100);
  const className =
    pct >= 50
      ? "bg-medical-100 text-medical-800"
      : pct >= 25
        ? "bg-amber-100 text-amber-800"
        : "bg-slate-100 text-slate-600";
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${className}`}
    >
      {pct}% model confidence
    </span>
  );
}

function Section({
  title,
  children,
  muted = false,
}: {
  title: string;
  children: ReactNode;
  muted?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        muted ? "border-slate-200 bg-slate-50" : "border-medical-100 bg-white"
      }`}
    >
      <h3
        className={`text-xs font-bold uppercase tracking-wider ${
          muted ? "text-slate-500" : "text-medical-600"
        }`}
      >
        {title}
      </h3>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function ReportBody({ report }: { report: AiReport }) {
  const findings = report.findings ?? [];
  const limitations = report.limitations ?? [];
  const urgency = report.urgency ? URGENCY_STYLES[report.urgency] : null;
  const UrgencyIcon = urgency?.icon;

  return (
    <div className="mt-5 space-y-4">
      <Section title="Summary">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="min-w-0 flex-1 text-sm leading-relaxed text-slate-700">
            {report.summary}
          </p>
          {urgency && UrgencyIcon && (
            <span
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold ${urgency.className}`}
            >
              <UrgencyIcon className="h-3.5 w-3.5" />
              {urgency.label}
            </span>
          )}
        </div>
      </Section>

      {findings.length > 0 && (
        <Section title="Flagged Findings — What They Mean">
          <div className="space-y-3">
            {findings.map((f, i) => (
              <motion.div
                key={`${f.flag}-${i}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + i * 0.12 }}
                className="rounded-lg border border-medical-100 bg-medical-50/40 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-800">
                    {formatFlagName(f.flag)}
                  </span>
                  <ConfidenceChip confidence={f.confidence} />
                </div>
                {f.explanation && (
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">
                    {f.explanation}
                  </p>
                )}
              </motion.div>
            ))}
          </div>
        </Section>
      )}

      {report.overall_interpretation && (
        <Section title="Overall Interpretation">
          <p className="text-sm leading-relaxed text-slate-700">
            {report.overall_interpretation}
          </p>
        </Section>
      )}

      <Section title="Recommendations">
        <ol className="space-y-2.5">
          {report.recommendations.map((rec, i) => (
            <motion.li
              key={i}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 + i * 0.1 }}
              className="flex items-start gap-3 text-sm leading-relaxed text-slate-700"
            >
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-medical-100 text-[11px] font-bold text-medical-700">
                {i + 1}
              </span>
              {rec}
            </motion.li>
          ))}
        </ol>
      </Section>

      {limitations.length > 0 && (
        <Section title="Limitations & Caveats" muted>
          <ul className="space-y-1.5">
            {limitations.map((lim, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-xs leading-relaxed text-slate-500"
              >
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                {lim}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs italic text-slate-500">
        {report.disclaimer}
      </p>

      {report.generated_by === "template" && (
        <p className="text-[11px] text-slate-400">
          Note: generated from a rule-based template. Set AI_API_KEY in the
          backend .env to enable LLM-generated reports.
        </p>
      )}
    </div>
  );
}

export default function AiReportCard({ result }: { result: ECGResult }) {
  const [report, setReport] = useState<AiReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards against double-firing in React StrictMode (dev) — the report
  // is generated exactly once per displayed result.
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
      setError(err instanceof Error ? err.message : "Report generation failed");
    } finally {
      setLoading(false);
    }
  }, [result.id]);

  // The report generates automatically as soon as a result is shown —
  // right after classification on upload, and when selecting a history row.
  useEffect(() => {
    if (generatedFor.current === result.id) return;
    generatedFor.current = result.id;
    void generate();
  }, [result.id, generate]);

  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.15, ease: "easeOut" }}
      className="rounded-2xl border border-medical-100 bg-gradient-to-br from-white to-medical-50 p-6 shadow-lg shadow-medical-100/50"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-medical-600 text-white shadow-md shadow-medical-200">
            <Sparkles className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-900">
              AI Clinical Summary
            </h2>
            <p className="text-xs text-slate-500">
              Generated automatically after analysis
            </p>
          </div>
        </div>

        {loading ? (
          <span className="flex items-center gap-1.5 rounded-full bg-medical-50 px-3 py-1.5 text-xs font-medium text-medical-700">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Analyzing with AI…
          </span>
        ) : report ? (
          <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Report ready
          </span>
        ) : null}
      </div>

      {/* Loading shimmer */}
      <AnimatePresence>
        {loading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="mt-5 space-y-3"
          >
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0.4 }}
                animate={{ opacity: [0.4, 1, 0.4] }}
                transition={{ repeat: Infinity, duration: 1.4, delay: i * 0.2 }}
                className="h-4 rounded-full bg-medical-100"
                style={{ width: `${85 - i * 15}%` }}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {error && !loading && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-medical-100 px-3 py-2"
        >
          <p className="flex items-center gap-2 text-sm font-medium text-medical-800">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </p>
          <button
            onClick={() => void generate()}
            className="flex items-center gap-1.5 rounded-lg bg-medical-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-medical-700"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Retry
          </button>
        </motion.div>
      )}

      {/* Report content */}
      <AnimatePresence>
        {report && !loading && (
          <motion.div
            key="report"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <ReportBody report={report} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
