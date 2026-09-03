"use client";

import { motion } from "framer-motion";
import {
  ShieldCheck,
  AlertTriangle,
  Clock,
  FileText,
  User,
  Activity,
} from "lucide-react";
import type { ECGResult } from "@/lib/api";
import { formatFlagName } from "@/lib/api";

export default function ResultsPanel({ result }: { result: ECGResult }) {
  const abnormal = result.overall_prediction === "abnormal";

  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="rounded-2xl border border-medical-100 bg-white shadow-lg shadow-medical-100/50"
    >
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-medical-500" />
          <h2 className="font-display text-sm font-bold text-slate-900">
            Analysis Results
          </h2>
        </div>

        {/* Prediction badge */}
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 20, delay: 0.2 }}
          className={`flex items-center gap-1.5 rounded-full px-3.5 py-1 text-xs font-bold uppercase tracking-wide ${
            abnormal
              ? "bg-red-600 text-white shadow-md shadow-red-200"
              : "bg-emerald-100 text-emerald-700"
          }`}
        >
          {abnormal ? (
            <AlertTriangle className="h-3.5 w-3.5" />
          ) : (
            <ShieldCheck className="h-3.5 w-3.5" />
          )}
          {result.overall_prediction}
        </motion.div>
      </div>

      <div className="p-5">
        {/* Patient meta */}
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <User className="h-3.5 w-3.5 text-medical-400" />
            {result.patient_id}
          </span>
          <span className="flex items-center gap-1.5 truncate max-w-[180px]">
            <FileText className="h-3.5 w-3.5 text-medical-400" />
            {result.filename}
          </span>
          <span className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-medical-400" />
            {new Date(result.created_at).toLocaleString()}
          </span>
        </div>

        {/* Flags */}
        <div className="mt-4">
          {result.flags.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3"
            >
              <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-500" />
              <div>
                <p className="text-sm font-semibold text-emerald-700">
                  No abnormalities detected
                </p>
                <p className="text-xs text-emerald-600/70">
                  All diagnostic superclasses below threshold
                </p>
              </div>
            </motion.div>
          ) : (
            <div className="space-y-2">
              {result.flags.map((flag, i) => {
                const conf = result.confidence_scores[i] ?? 0;
                const pct = Math.round(conf * 100);
                const strength =
                  conf >= 0.5 ? "strong" : conf >= 0.25 ? "moderate" : "weak";
                return (
                  <motion.div
                    key={flag}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.15 + i * 0.08 }}
                    className="group rounded-xl border border-medical-100 bg-gradient-to-r from-medical-50/60 to-white p-3 transition-shadow hover:shadow-md"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold text-slate-800">
                        {formatFlagName(flag)}
                      </span>
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${
                            strength === "strong"
                              ? "bg-red-100 text-red-700"
                              : strength === "moderate"
                                ? "bg-amber-100 text-amber-700"
                                : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {strength}
                        </span>
                        <span className="rounded-md bg-red-600 px-2 py-0.5 text-xs font-bold tabular-nums text-white">
                          {pct}%
                        </span>
                      </div>
                    </div>
                    {/* Confidence bar */}
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-medical-100">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{
                          duration: 0.8,
                          delay: 0.3 + i * 0.08,
                          ease: "easeOut",
                        }}
                        className={`h-full rounded-full ${
                          conf >= 0.5
                            ? "bg-red-500"
                            : conf >= 0.25
                              ? "bg-amber-400"
                              : "bg-slate-300"
                        }`}
                      />
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </motion.section>
  );
}
