"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Upload } from "lucide-react";
import WorkflowShowcase from "@/components/landing/WorkflowShowcase";

export default function Home() {
  return (
    <div className="min-h-screen">
      {/* ── Header ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5 sm:px-6">
          <div className="flex items-baseline gap-2.5">
            <span className="font-display text-lg font-bold tracking-tight text-slate-900">
              CardioLens
            </span>
            <span className="hidden text-xs text-slate-400 sm:inline">
              ECG Analysis Platform
            </span>
          </div>
          <Link
            href="/upload"
            className="rounded-lg bg-medical-700 px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-medical-800"
          >
            Upload ECG
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        {/* ── Hero — the workflow graphics do the explaining ── */}
        <section className="relative pt-8 text-center sm:pt-12">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
          >
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-medical-700">
              Clinical decision support
            </p>
            <h1 className="mx-auto mt-3 max-w-2xl font-display text-2xl font-bold leading-tight tracking-tight text-slate-900 sm:text-3xl lg:text-4xl">
              Upload an ECG. Get a{" "}
              <span className="text-medical-700">clinical report</span>.
            </h1>
          </motion.div>

          {/* The workflow itself is the hero */}
          <WorkflowShowcase />

          {/* CTA */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.45 }}
            className="mt-10 sm:mt-12"
          >
            <Link
              href="/upload"
              className="group inline-flex items-center gap-2.5 rounded-xl bg-medical-700 px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-medical-300/60 transition-all hover:-translate-y-0.5 hover:bg-medical-800 hover:shadow-xl hover:shadow-medical-400/50"
            >
              <Upload className="h-5 w-5" />
              Upload ECG
            </Link>
            <p className="mt-3 text-[11px] text-slate-400">
              No account needed · WFDB, CSV or EDF · Results in seconds
            </p>
          </motion.div>
        </section>
      </main>

      {/* ── Footer ──────────────────────────────────────────── */}
      <footer className="border-t border-slate-200 py-8">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <p className="text-xs leading-relaxed text-slate-500">
            This tool provides decision support only and does not constitute a
            diagnosis. Output must be verified against the raw waveform by the
            treating physician, who retains full responsibility for clinical
            interpretation and decisions.
          </p>
          <p className="mt-3 text-[11px] text-slate-400">
            CardioLens · CNN classifier trained on PTB-XL · Reporting grounded
            in AHA/ACCF/HRS 2009 recommendations
          </p>
        </div>
      </footer>
    </div>
  );
}
