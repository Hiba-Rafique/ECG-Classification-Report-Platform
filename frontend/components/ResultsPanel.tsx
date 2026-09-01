"use client";

import { motion } from "framer-motion";
import { ShieldCheck, AlertTriangle, Clock, FileText, User } from "lucide-react";
import type { ECGResult } from "@/lib/api";
import { formatFlagName } from "@/lib/api";
import Waveform from "./Waveform";

export default function ResultsPanel({ result }: { result: ECGResult }) {
  const abnormal = result.overall_prediction === "abnormal";

  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="rounded-2xl border border-medical-100 bg-white p-6 shadow-lg shadow-medical-100/50"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="font-display text-lg font-semibold text-slate-900">
          Analysis Results
        </h2>

        {/* Prediction badge */}
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 20, delay: 0.2 }}
          className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-bold uppercase tracking-wide ${
            abnormal
              ? "bg-medical-600 text-white shadow-md shadow-medical-300"
              : "bg-emerald-100 text-emerald-700"
          }`}
        >
          {abnormal ? (
            <AlertTriangle className="h-4 w-4" />
          ) : (
            <ShieldCheck className="h-4 w-4" />
          )}
          {result.overall_prediction}
        </motion.div>
      </div>

      {/* Meta */}
      <div className="mt-4 grid gap-2 text-sm text-slate-600 sm:grid-cols-3">
        <span className="flex items-center gap-2">
          <User className="h-4 w-4 text-medical-400" />
          {result.patient_id}
        </span>
        <span className="flex items-center gap-2 truncate">
          <FileText className="h-4 w-4 text-medical-400" />
          {result.filename}
        </span>
        <span className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-medical-400" />
          {new Date(result.created_at).toLocaleString()}
        </span>
      </div>

      {/* Waveform */}
      <div className="mt-6">
        <h3 className="mb-2 text-sm font-semibold text-slate-700">
          ECG Waveform — flagged regions highlighted
        </h3>
        <Waveform result={result} />
      </div>

      {/* Flags */}
      <div className="mt-6">
        <h3 className="mb-3 text-sm font-semibold text-slate-700">
          Flagged Findings
        </h3>
        {result.flags.length === 0 ? (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="rounded-lg bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700"
          >
            No abnormalities flagged by the model.
          </motion.p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {result.flags.map((flag, i) => {
              const conf = result.confidence_scores[i] ?? 0;
              const pct = Math.round(conf * 100);
              return (
                <motion.div
                  key={flag}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.15 + i * 0.08 }}
                  whileHover={{ scale: 1.03 }}
                  className="w-full rounded-xl border border-medical-200 bg-medical-50 p-3 sm:w-auto sm:min-w-56"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-medical-900">
                      {formatFlagName(flag)}
                    </span>
                    <span className="rounded-md bg-medical-600 px-2 py-0.5 text-xs font-bold text-white">
                      {pct}%
                    </span>
                  </div>
                  {/* Confidence bar */}
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-medical-100">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.8, delay: 0.3 + i * 0.08, ease: "easeOut" }}
                      className="h-full rounded-full bg-medical-500"
                    />
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </motion.section>
  );
}
