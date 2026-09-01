"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { HeartPulse, ShieldCheck, Zap, Eye } from "lucide-react";
import UploadCard from "@/components/UploadCard";
import ResultsPanel from "@/components/ResultsPanel";
import AiReportCard from "@/components/AiReportCard";
import HistoryTable from "@/components/HistoryTable";
import EcgLine from "@/components/EcgLine";
import { getResult, getHistory, type ECGResult } from "@/lib/api";

export default function Home() {
  const [result, setResult] = useState<ECGResult | null>(null);
  const [history, setHistory] = useState<ECGResult[]>([]);

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await getHistory());
    } catch {
      // Backend offline — history stays empty; errors surface on upload/report
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const handleUploaded = useCallback(
    async (id: number) => {
      try {
        setResult(await getResult(id));
        await loadHistory();
      } catch {
        // Result fetch failed; upload card already showed success state
      }
    },
    [loadHistory]
  );

  const handleSelectHistory = useCallback(async (id: number) => {
    try {
      setResult(await getResult(id));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      // ignore — history row click is best-effort
    }
  }, []);

  return (
    <div className="min-h-screen">
      {/* ── Header ─────────────────────────────────────────── */}
      <motion.header
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="sticky top-0 z-40 border-b border-medical-100 bg-white/80 backdrop-blur-md"
      >
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-medical-600 text-white shadow-md shadow-medical-200">
              <HeartPulse className="h-5 w-5" />
              <span className="absolute inset-0 rounded-xl bg-medical-400/40 animate-pulse-ring" />
            </span>
            <div>
              <p className="font-display text-base font-bold leading-tight text-slate-900">
                CardioLens
              </p>
              <p className="text-[11px] leading-tight text-slate-400">
                ECG Analysis Platform
              </p>
            </div>
          </div>
          <span className="hidden items-center gap-1.5 rounded-full bg-medical-50 px-3 py-1 text-xs font-medium text-medical-700 sm:flex">
            <ShieldCheck className="h-3.5 w-3.5" />
            Doctor-in-the-loop decision support
          </span>
        </div>
      </motion.header>

      <main className="mx-auto max-w-5xl px-6 pb-16">
        {/* ── Hero ─────────────────────────────────────────── */}
        <section className="relative py-12">
          <EcgLine className="absolute inset-x-0 top-8 w-full opacity-30" height={80} />
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="relative"
          >
            <h1 className="font-display text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
              Catch what the eye
              <span className="text-medical-600"> misses.</span>
            </h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-500">
              Upload an ECG recording. Our CNN flags regions likely to indicate
              abnormalities with confidence scores — so you can cross-check your
              reading, not replace it.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              {[
                { icon: Zap, label: "Instant analysis" },
                { icon: Eye, label: "Explainable flags" },
                { icon: ShieldCheck, label: "You make the final call" },
              ].map(({ icon: Icon, label }, i) => (
                <motion.span
                  key={label}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.4 + i * 0.1 }}
                  className="flex items-center gap-1.5 rounded-full border border-medical-100 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm"
                >
                  <Icon className="h-3.5 w-3.5 text-medical-500" />
                  {label}
                </motion.span>
              ))}
            </div>
          </motion.div>
        </section>

        {/* ── Upload ───────────────────────────────────────── */}
        <UploadCard onUploaded={handleUploaded} />

        {/* ── Results + AI Report ──────────────────────────── */}
        {result && (
          <div className="mt-6 space-y-6">
            <ResultsPanel result={result} />
            <AiReportCard result={result} />
          </div>
        )}

        {/* ── History ──────────────────────────────────────── */}
        <div className="mt-6">
          <HistoryTable results={history} onSelect={handleSelectHistory} />
        </div>
      </main>

      {/* ── Footer ──────────────────────────────────────────── */}
      <footer className="border-t border-medical-100 bg-white/60 py-6 text-center">
        <p className="text-xs text-slate-400">
          This tool provides decision support only. The doctor always makes the
          final diagnosis.
        </p>
      </footer>
    </div>
  );
}
