"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  HeartPulse,
  ShieldCheck,
  Zap,
  Eye,
  Activity,
  Brain,
  Stethoscope,
} from "lucide-react";
import UploadCard from "@/components/UploadCard";
import ResultsPanel from "@/components/ResultsPanel";
import ClinicalSummary from "@/components/ClinicalSummary";
import Waveform from "@/components/Waveform";
import HistoryTable from "@/components/HistoryTable";
import EcgLine from "@/components/EcgLine";
import { getResult, getHistory, type ECGResult } from "@/lib/api";

// ── Decorative floating orbs ──────────────────────────────────
function FloatingOrbs() {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
      <motion.div
        animate={{
          y: [0, -30, 0],
          opacity: [0.08, 0.15, 0.08],
        }}
        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
        className="absolute -top-32 -right-32 h-96 w-96 rounded-full bg-medical-300/20 blur-3xl"
      />
      <motion.div
        animate={{
          y: [0, 20, 0],
          opacity: [0.06, 0.12, 0.06],
        }}
        transition={{ duration: 15, repeat: Infinity, ease: "easeInOut", delay: 3 }}
        className="absolute top-1/3 -left-48 h-80 w-80 rounded-full bg-medical-200/20 blur-3xl"
      />
      <motion.div
        animate={{
          scale: [1, 1.1, 1],
          opacity: [0.04, 0.08, 0.04],
        }}
        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 6 }}
        className="absolute bottom-20 right-1/4 h-64 w-64 rounded-full bg-medical-400/10 blur-3xl"
      />
    </div>
  );
}

// ── Animated heart icon with pulse ring ───────────────────────
function PulsingHeart() {
  return (
    <span className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-red-500 to-red-700 text-white shadow-lg shadow-red-200/60">
      <HeartPulse className="h-5 w-5" />
      <span className="absolute inset-0 rounded-xl bg-red-400/30 animate-pulse-ring" />
    </span>
  );
}

// ── Main page ─────────────────────────────────────────────────

export default function Home() {
  const [result, setResult] = useState<ECGResult | null>(null);
  const [history, setHistory] = useState<ECGResult[]>([]);

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await getHistory());
    } catch {
      // Backend offline — history stays empty
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
        // Result fetch failed
      }
    },
    [loadHistory],
  );

  const handleSelectHistory = useCallback(async (id: number) => {
    try {
      setResult(await getResult(id));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      // ignore
    }
  }, []);

  return (
    <div className="relative min-h-screen">
      <FloatingOrbs />

      {/* ── Header ─────────────────────────────────────────── */}
      <motion.header
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="sticky top-0 z-40 border-b border-medical-100/80 bg-white/80 backdrop-blur-lg"
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <PulsingHeart />
            <div>
              <p className="font-display text-base font-bold leading-tight text-slate-900">
                CardioLens
              </p>
              <p className="hidden text-[11px] leading-tight text-slate-400 sm:block">
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

      <main className="relative mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        {/* ── Hero ─────────────────────────────────────────── */}
        <section className="relative py-10 sm:py-14">
          <EcgLine className="absolute inset-x-0 top-6 w-full opacity-20" height={90} />
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="relative"
          >
            <h1 className="font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
              Catch what the eye
              <span className="bg-gradient-to-r from-medical-600 to-medical-400 bg-clip-text text-transparent">
                {" "}misses.
              </span>
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-500 sm:mt-4 sm:text-base">
              Upload an ECG recording. Our CNN flags regions likely to indicate
              abnormalities with confidence scores — so you can cross-check your
              reading, not replace it.
            </p>
            <div className="mt-5 flex flex-wrap gap-2 sm:mt-6 sm:gap-3">
              {[
                { icon: Zap, label: "Instant analysis" },
                { icon: Eye, label: "Explainable flags" },
                { icon: Brain, label: "Guideline-grounded AI" },
                { icon: Stethoscope, label: "You make the final call" },
              ].map(({ icon: Icon, label }, i) => (
                <motion.span
                  key={label}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.4 + i * 0.1 }}
                  className="flex items-center gap-1.5 rounded-full border border-medical-100 bg-white/80 px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm backdrop-blur-sm"
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

        {/* ── Results section ──────────────────────────────── */}
        {result && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4 }}
            className="mt-8 space-y-6"
          >
            {/* ECG Waveform — full width for maximum impact */}
            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.05 }}
              className="rounded-2xl border border-medical-100 bg-white p-4 shadow-lg shadow-medical-100/30 sm:p-5"
            >
              <div className="mb-3 flex items-center gap-2">
                <Activity className="h-4 w-4 text-medical-500" />
                <h2 className="font-display text-sm font-bold text-slate-900">
                  12-Lead ECG Waveform
                </h2>
                {result.flags.length > 0 && (
                  <span className="ml-auto rounded-full bg-medical-50 px-2.5 py-0.5 text-[11px] font-semibold text-medical-600">
                    Flagged regions highlighted
                  </span>
                )}
              </div>
              <Waveform result={result} />
            </motion.section>

            {/* Results + Clinical Summary — side by side on large screens */}
            <div className="grid gap-6 lg:grid-cols-2">
              <ResultsPanel result={result} />
              <ClinicalSummary result={result} />
            </div>
          </motion.div>
        )}

        {/* ── History ──────────────────────────────────────── */}
        <div className="mt-8">
          <HistoryTable results={history} onSelect={handleSelectHistory} />
        </div>
      </main>

      {/* ── Footer ──────────────────────────────────────────── */}
      <footer className="relative border-t border-medical-100/80 bg-white/60 py-6 text-center backdrop-blur-sm">
        <div className="flex items-center justify-center gap-2 text-xs text-slate-400">
          <HeartPulse className="h-3.5 w-3.5 animate-heartbeat text-medical-400" />
          <p>
            This tool provides decision support only. The doctor always makes the
            final diagnosis.
          </p>
        </div>
      </footer>
    </div>
  );
}
