"use client";

import { motion } from "framer-motion";
import { History } from "lucide-react";
import type { ECGResult } from "@/lib/api";
import { formatFlagName } from "@/lib/api";

export default function HistoryTable({
  results,
  onSelect,
}: {
  results: ECGResult[];
  onSelect: (id: number) => void;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3 }}
      className="rounded-2xl border border-medical-100 bg-white p-6 shadow-lg shadow-medical-100/50"
    >
      <div className="flex items-center gap-2">
        <History className="h-5 w-5 text-medical-500" />
        <h2 className="font-display text-lg font-semibold text-slate-900">
          Analysis History
        </h2>
      </div>

      {results.length === 0 ? (
        <p className="mt-4 rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">
          No analyses yet — upload an ECG to get started.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-medical-100 text-xs uppercase tracking-wider text-slate-400">
                <th className="px-2 py-2 font-semibold">ID</th>
                <th className="px-2 py-2 font-semibold">Patient</th>
                <th className="px-2 py-2 font-semibold">Prediction</th>
                <th className="px-2 py-2 font-semibold">Flags</th>
                <th className="px-2 py-2 font-semibold">Date</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <motion.tr
                  key={r.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.04 }}
                  onClick={() => onSelect(r.id)}
                  className="cursor-pointer border-b border-slate-100 transition-colors last:border-0 hover:bg-medical-50"
                >
                  <td className="px-2 py-2.5 font-medium text-slate-500">
                    #{r.id}
                  </td>
                  <td className="px-2 py-2.5 text-slate-700">{r.patient_id}</td>
                  <td className="px-2 py-2.5">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        r.overall_prediction === "abnormal"
                          ? "bg-red-100 text-red-700"
                          : "bg-emerald-100 text-emerald-700"
                      }`}
                    >
                      {r.overall_prediction}
                    </span>
                  </td>
                  <td className="max-w-56 truncate px-2 py-2.5 text-slate-600">
                    {r.flags.length > 0
                      ? r.flags.map(formatFlagName).join(", ")
                      : "—"}
                  </td>
                  <td className="px-2 py-2.5 text-slate-500">
                    {new Date(r.created_at).toLocaleDateString()}
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </motion.section>
  );
}
