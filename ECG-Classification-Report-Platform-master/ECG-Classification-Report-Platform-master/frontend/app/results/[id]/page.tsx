"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { AlertCircle } from "lucide-react";
import EcgLine from "@/components/EcgLine";
import Waveform from "@/components/Waveform";
import ResultsPanel from "@/components/ResultsPanel";
import ClinicalSummary from "@/components/ClinicalSummary";
import { getResult, getSignal, type ECGResult, type ECGSignal } from "@/lib/api";

export default function ResultsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const numericId = Number(id);
  const [result, setResult] = useState<ECGResult | null>(null);
  const [signal, setSignal] = useState<ECGSignal | null>(null);
  const [signalFailed, setSignalFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isFinite(numericId)) {
      setError("Invalid result ID.");
      return;
    }
    let cancelled = false;
    getResult(numericId)
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .catch(() => {
        if (!cancelled) {
          setError(
            `Result #${numericId} could not be loaded. It may not exist, or the backend is offline.`,
          );
        }
      });
    // The waveform's real signal loads in parallel — the page still
    // renders if only this fetch fails (Waveform shows a notice).
    getSignal(numericId)
      .then((s) => {
        if (!cancelled) setSignal(s);
      })
      .catch(() => {
        if (!cancelled) setSignalFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [numericId]);

  return (
    <div className="min-h-screen">
      {/* ── Header ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5 sm:px-6">
          <Link
            href="/"
            className="font-display text-base font-bold tracking-tight text-slate-900"
          >
            CardioLens
          </Link>
          <Link
            href="/upload"
            className="rounded-lg bg-medical-700 px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-medical-800"
          >
            New analysis
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-20 pt-8 sm:px-6">
        {/* ── Error ────────────────────────────────────────── */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="mx-auto max-w-md rounded-xl border border-red-200 bg-red-50 p-8 text-center"
          >
            <AlertCircle className="mx-auto h-9 w-9 text-red-500" />
            <p className="mt-3 text-sm font-medium text-red-700">{error}</p>
            <Link
              href="/upload"
              className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-medical-700 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-medical-800"
            >
              Start a new analysis
            </Link>
          </motion.div>
        )}

        {/* ── Loading ──────────────────────────────────────── */}
        {!error && !result && (
          <div className="flex flex-col items-center justify-center py-16">
            <EcgLine height={70} className="w-full max-w-md opacity-70" />
            <p className="mt-5 text-sm font-medium text-slate-500">
              Loading analysis…
            </p>
            <div className="mt-6 w-full max-w-md space-y-3">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-16 animate-pulse rounded-xl bg-slate-100/80"
                  style={{ animationDelay: `${i * 150}ms` }}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Report ───────────────────────────────────────── */}
        {result && (
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="space-y-6"
          >
            {/* Waveform */}
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-sm font-bold text-slate-900">
                  12-Lead ECG
                </h2>
                {result.flags.length > 0 && (
                  <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-[11px] font-semibold text-red-700 ring-1 ring-red-200">
                    {result.flags.length} finding
                    {result.flags.length > 1 ? "s" : ""} — flagged leads
                    highlighted
                  </span>
                )}
              </div>
              <Waveform result={result} signal={signal} signalFailed={signalFailed} />
            </section>

            {/* Model output + clinical summary */}
            <div className="grid gap-6 lg:grid-cols-2">
              <ResultsPanel result={result} />
              <ClinicalSummary result={result} />
            </div>
          </motion.div>
        )}
      </main>

      {/* ── Footer ──────────────────────────────────────────── */}
      {result && (
        <footer className="border-t border-slate-200 py-6">
          <p className="mx-auto max-w-6xl px-4 text-xs leading-relaxed text-slate-400 sm:px-6">
            This report is decision support only. Verify flagged regions
            against the raw waveform before acting on them.
          </p>
        </footer>
      )}
    </div>
  );
}
