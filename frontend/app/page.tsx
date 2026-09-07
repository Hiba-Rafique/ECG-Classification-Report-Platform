"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Upload } from "lucide-react";
import WorkflowShowcase from "@/components/landing/WorkflowShowcase";

export default function Home() {
  return (
    <div className="min-h-screen">
      {/* ── Header ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5 sm:px-6">
          <div className="flex items-baseline gap-2.5">
            <span className="font-display text-lg font-bold tracking-tight text-white">
              CardioLens
            </span>
            <span className="hidden text-xs text-white/70 sm:inline">
              ECG Analysis Platform
            </span>
          </div>
          <Link
            href="/upload"
            className="rounded-lg bg-white px-4 py-1.5 text-sm font-medium text-black shadow-sm transition-colors hover:bg-brand hover:text-white"
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
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white">
              Clinical decision support
            </p>
            <h1 className="mx-auto mt-3 max-w-2xl font-display text-2xl font-bold leading-tight tracking-tight text-white sm:text-3xl lg:text-4xl">
              Upload an ECG. Get a{" "}
              <span className="underline decoration-white/50 decoration-2 underline-offset-4">clinical report</span>.
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
              className="group inline-flex items-center gap-2.5 rounded-xl bg-black px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-black/40 transition-all hover:-translate-y-0.5 hover:bg-brand hover:shadow-xl hover:shadow-black/50"
            >
              <Upload className="h-5 w-5" />
              Upload ECG
            </Link>
            <p className="mt-3 text-[11px] text-white">
              No account needed · WFDB, CSV or EDF · Results in seconds
            </p>
          </motion.div>
        </section>
      </main>

      {/* ── Footer ──────────────────────────────────────────── */}
      <footer className="border-t border-white/15 py-8">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <p className="text-xs leading-relaxed text-white">
            This tool provides decision support only and does not constitute a
            diagnosis. Output must be verified against the raw waveform by the
            treating physician, who retains full responsibility for clinical
            interpretation and decisions.
          </p>
          <p className="mt-3 text-[11px] text-white">
            CardioLens · CNN classifier trained on PTB-XL · Reporting grounded
            in AHA/ACCF/HRS 2009 recommendations
          </p>
        </div>
      </footer>
    </div>
  );
}
