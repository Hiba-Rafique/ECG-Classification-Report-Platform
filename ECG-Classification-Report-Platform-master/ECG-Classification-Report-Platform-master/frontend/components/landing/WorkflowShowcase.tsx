"use client";

import { motion } from "framer-motion";
import { Upload, ScanHeart, FileDown, ChevronRight } from "lucide-react";
import EcgLine from "@/components/EcgLine";

// ── Step mockups ──────────────────────────────────────────────
// Three animated product mockups that double as the how-to-use
// workflow: an ECG recording, the model's classification output,
// and the generated clinical report.

function EcgRecordingMock() {
  return (
    <div className="w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-200/70">
      {/* window bar */}
      <div className="flex items-center gap-1.5 border-b border-slate-100 bg-slate-50/70 px-4 py-2.5">
        <span className="h-2 w-2 rounded-full bg-slate-300" />
        <span className="h-2 w-2 rounded-full bg-slate-300" />
        <span className="h-2 w-2 rounded-full bg-slate-300" />
        <span className="ml-2 truncate text-[10px] font-medium text-slate-400">
          recording_001.dat
        </span>
      </div>

      {/* stacked lead traces */}
      <div className="ecg-grid space-y-0.5 px-3 py-3">
        <EcgLine height={30} delay={0} className="w-full" />
        <EcgLine height={30} delay={0.85} className="w-full opacity-60" />
        <EcgLine height={30} delay={1.7} className="w-full opacity-30" />
      </div>

      <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2">
        <span className="text-[10px] font-medium text-slate-400">
          12-lead · 500 Hz
        </span>
        <span className="flex items-center gap-1.5 text-[10px] font-medium text-slate-400">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-medical-500" />
          10 s recording
        </span>
      </div>
    </div>
  );
}

function ClassificationMock() {
  return (
    <div className="w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-200/70">
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-4 py-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          CNN Analysis
        </span>
        <span className="rounded-full bg-red-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-red-600 ring-1 ring-red-200">
          Abnormal
        </span>
      </div>

      <div className="space-y-3 px-4 py-4">
        {/* Top finding */}
        <div className="rounded-xl border border-red-100 bg-red-50/50 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-red-700">
              Myocardial Infarction
            </span>
            <motion.span
              animate={{ scale: [1, 1.07, 1] }}
              transition={{ duration: 1.8, repeat: Infinity }}
              className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white"
            >
              87%
            </motion.span>
          </div>

          {/* Mini ECG with flagged ST-elevation window */}
          <svg viewBox="0 0 200 48" className="mt-2 w-full">
            <rect
              x="72"
              y="4"
              width="66"
              height="40"
              rx="4"
              fill="rgba(239,68,68,0.07)"
              stroke="rgba(239,68,68,0.4)"
              strokeWidth="1"
              strokeDasharray="3 2.5"
            />
            <path
              d="M0,30 L46,30 L53,26 L60,30 L70,30 L75,33 L81,10 L87,40 L92,24 L112,24 L120,24 L128,14 L136,24 L142,30 L200,30"
              fill="none"
              stroke="#ef4444"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>

          <div className="mt-2 h-1 overflow-hidden rounded-full bg-red-100">
            <motion.div
              initial={{ width: 0 }}
              whileInView={{ width: "87%" }}
              viewport={{ once: true }}
              transition={{ duration: 1, delay: 0.4 }}
              className="h-full rounded-full bg-red-500"
            />
          </div>
        </div>

        {/* Runner-up class */}
        <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-400">Normal</span>
            <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-slate-400">
              6%
            </span>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full w-[6%] rounded-full bg-slate-300" />
          </div>
        </div>
      </div>
    </div>
  );
}

function ReportMock() {
  return (
    <div className="w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-200/70">
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-4 py-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          Clinical Summary
        </span>
        <span className="flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-red-600 ring-1 ring-red-200">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
          Review now
        </span>
      </div>

      <div className="space-y-2.5 px-4 py-4">
        {/* Summary skeleton */}
        <div className="space-y-1.5">
          <div className="h-2 w-full rounded-full bg-slate-100" />
          <div className="h-2 w-4/5 rounded-full bg-slate-100" />
        </div>

        {/* Findings */}
        <div className="flex items-center justify-between rounded-lg border border-slate-100 px-2.5 py-2">
          <span className="text-[11px] font-semibold text-slate-700">
            Myocardial Infarction
          </span>
          <span className="text-[11px] font-bold tabular-nums text-red-600">
            87%
          </span>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-slate-100 px-2.5 py-2">
          <span className="text-[11px] font-semibold text-slate-500">
            ST/T Abnormality
          </span>
          <span className="text-[11px] font-bold tabular-nums text-slate-400">
            24%
          </span>
        </div>

        {/* Recommended action */}
        <div className="flex items-start gap-2 rounded-lg bg-medical-50 px-2.5 py-2">
          <span className="mt-0.5 text-[10px] font-bold text-medical-700">1</span>
          <div className="flex-1 space-y-1 pt-0.5">
            <div className="h-1.5 w-full rounded-full bg-medical-100" />
            <div className="h-1.5 w-3/5 rounded-full bg-medical-100" />
          </div>
        </div>
      </div>

      <div className="border-t border-slate-100 px-4 py-3">
        <motion.span
          animate={{ scale: [1, 1.02, 1] }}
          transition={{ duration: 2.4, repeat: Infinity }}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-medical-700 py-1.5 text-[11px] font-semibold text-white shadow-sm"
        >
          <FileDown className="h-3 w-3" />
          Export PDF
        </motion.span>
      </div>
    </div>
  );
}

// ── Showcase section ──────────────────────────────────────────

const STEPS = [
  { icon: Upload, title: "Upload a recording", Mock: EcgRecordingMock },
  { icon: ScanHeart, title: "Instant analysis", Mock: ClassificationMock },
  { icon: FileDown, title: "Clinical report", Mock: ReportMock },
];

const ROTATIONS = [-2.5, 0, 2.5];

export default function WorkflowShowcase() {
  return (
    <div className="relative mt-9 sm:mt-12">
      {/* Centre card is the focal point — wider column, slight scale, red glow */}
      <div className="grid gap-9 md:grid-cols-[1fr_1.22fr_1fr] md:items-center md:gap-6 lg:gap-8">
        {STEPS.map((step, i) => {
          const isCenter = i === 1;
          return (
            <div key={step.title} className="relative">
              {/* Step label — number + title only, the mockups do the explaining */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.15 + i * 0.12 }}
                className="mb-3.5 flex items-center gap-2.5"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-medical-700 text-white shadow-sm">
                  <step.icon className="h-3.5 w-3.5" />
                </span>
                <p className="text-[13px] font-semibold text-slate-900">
                  <span className="mr-1.5 font-display text-medical-300">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {step.title}
                </p>
              </motion.div>

              {/* Floating mockup */}
              <motion.div
                animate={{ y: [0, -7, 0] }}
                transition={{
                  duration: 5,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: i * 1.1,
                }}
              >
                <div
                  className={
                    isCenter
                      ? "relative md:scale-[1.05] md:drop-shadow-[0_22px_40px_rgba(220,38,38,0.16)]"
                      : "relative"
                  }
                >
                  {isCenter && (
                    <div
                      aria-hidden
                      className="absolute inset-x-3 -inset-y-6 -z-10 rounded-[2rem] bg-medical-100/70 blur-2xl"
                    />
                  )}
                  <motion.div
                    initial={{ opacity: 0, y: 24, rotate: ROTATIONS[i] }}
                    whileInView={{ opacity: 1, y: 0, rotate: ROTATIONS[i] }}
                    viewport={{ once: true, margin: "-40px" }}
                    transition={{ duration: 0.55, delay: 0.15 + i * 0.12 }}
                    whileHover={{ rotate: 0, scale: 1.02 }}
                  >
                    <step.Mock />
                  </motion.div>
                </div>
              </motion.div>

              {/* Connector arrow (desktop) */}
              {i < STEPS.length - 1 && (
                <motion.span
                  animate={{ x: [0, 5, 0] }}
                  transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.5 }}
                  className="absolute -right-4 top-[46%] z-10 hidden h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-medical-500 shadow-sm md:flex"
                >
                  <ChevronRight className="h-4 w-4" />
                </motion.span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
