"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  UploadCloud,
  Loader2,
  CheckCircle2,
  FileWarning,
  RefreshCw,
} from "lucide-react";
import EcgLine from "@/components/EcgLine";
import { uploadEcg } from "@/lib/api";

const ACCEPT = ".csv,.dat,.hea,.edf";

// Cosmetic pacing of the server-side pipeline — inference has already
// completed by the time the upload response arrives; this walks the
// physician through what happened before revealing the report.
const STAGES = [
  {
    label: "Preprocessing signal",
    desc: "Bandpass filter (0.5–45 Hz) · resample to 500 Hz · per-lead normalization",
  },
  {
    label: "Running CNN analysis",
    desc: "Scoring five diagnostic superclasses on the full 10-second recording",
  },
  {
    label: "Preparing the report",
    desc: "Assembling findings, guideline criteria and recommended actions",
  },
];

type Phase = "idle" | "uploading" | "processing" | "error";

export default function UploadPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [dragging, setDragging] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [fileName, setFileName] = useState("");
  const [resultId, setResultId] = useState<number | null>(null);
  const [stage, setStage] = useState(0);

  const handleFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setFileName(
      files.length === 1
        ? files[0].name
        : `${files.length} files (${files.map((f) => f.name).join(", ")})`,
    );
    setPhase("uploading");
    try {
      const res = await uploadEcg(files);
      setResultId(res.id);
      setStage(0);
      setPhase("processing");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Upload failed");
      setPhase("error");
    }
  }, []);

  // Advance through processing stages, then navigate to the report
  useEffect(() => {
    if (phase !== "processing" || resultId == null) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    STAGES.forEach((_, i) => {
      timers.push(setTimeout(() => setStage(i + 1), 1000 + i * 1200));
    });
    timers.push(
      setTimeout(
        () => router.push(`/results/${resultId}`),
        1000 + STAGES.length * 1200 + 500,
      ),
    );
    return () => timers.forEach(clearTimeout);
  }, [phase, resultId, router]);

  const reset = () => {
    setPhase("idle");
    setErrorMsg("");
    setResultId(null);
    setStage(0);
    setFileName("");
  };

  return (
    <div className="min-h-screen">
      {/* ── Header ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5 sm:px-6">
          <Link
            href="/"
            className="flex items-center gap-2 text-white/70 transition-colors hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="font-display text-base font-bold tracking-tight text-white">
              CardioLens
            </span>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-xl px-4 pb-20 pt-10 sm:px-6">
        <div className="text-center">
          <h1 className="font-display text-2xl font-bold tracking-tight text-white">
            Upload an ECG recording
          </h1>
          <p className="mt-2 text-sm text-white">
            12-lead · 500 Hz · 10 seconds — analyzed in one pass
          </p>
        </div>

        <AnimatePresence mode="wait">
          {/* ── Idle: dropzone ─────────────────────────────── */}
          {phase === "idle" && (
            <motion.div
              key="idle"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.3 }}
            >
              <motion.div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  const dropped = Array.from(e.dataTransfer.files ?? []);
                  if (dropped.length > 0) void handleFiles(dropped);
                }}
                onClick={() => inputRef.current?.click()}
                animate={{
                  scale: dragging ? 1.02 : 1,
                  borderColor: dragging ? "#000000" : "#7a0c1a",
                  backgroundColor: dragging ? "#f6dde2" : "#ffffff",
                }}
                whileHover={{ scale: 1.01 }}
                className="ecg-grid mt-8 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-12 transition-colors"
              >
                <motion.div
                  animate={dragging ? { y: [0, -8, 0] } : {}}
                  transition={{ repeat: Infinity, duration: 1.2 }}
                >
                  <UploadCloud className="h-10 w-10 text-brand" />
                </motion.div>
                <p className="font-medium text-black">
                  {dragging
                    ? "Drop the file to analyze"
                    : "Drag & drop your ECG file here"}
                </p>
                <p className="text-xs text-black/60">or click to browse</p>
                <input
                  ref={inputRef}
                  type="file"
                  accept={ACCEPT}
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const selected = Array.from(e.target.files ?? []);
                    if (selected.length > 0) void handleFiles(selected);
                  }}
                />
              </motion.div>
              <p className="mt-3 text-center text-xs text-white">
                WFDB (select .dat + .hea together), CSV, or EDF — up to 50 MB
              </p>
            </motion.div>
          )}

          {/* ── Uploading ──────────────────────────────────── */}
          {phase === "uploading" && (
            <motion.div
              key="uploading"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.3 }}
              className="mt-8 rounded-xl border border-black/10 bg-white p-8 text-center shadow-sm"
            >
              <Loader2 className="mx-auto h-10 w-10 animate-spin text-brand" />
              <p className="mt-4 font-medium text-black">
                Uploading &amp; analyzing…
              </p>
              <p className="mt-1 truncate text-xs text-black/60">{fileName}</p>
              <EcgLine
                height={40}
                className="mx-auto mt-6 w-full max-w-sm opacity-60"
              />
            </motion.div>
          )}

          {/* ── Processing stages ──────────────────────────── */}
          {phase === "processing" && (
            <motion.div
              key="processing"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.3 }}
              className="mt-8 overflow-hidden rounded-xl border border-black/10 bg-white shadow-sm"
            >
              <div className="border-b border-black/10 bg-black/5 px-5 py-3">
                <p className="text-sm font-semibold text-black">
                  Analyzing your recording
                </p>
                <p className="truncate text-xs text-black/60">{fileName}</p>
              </div>

              <div className="px-5 py-5">
                <EcgLine height={44} className="w-full opacity-70" />

                <div className="mt-5 space-y-4">
                  {STAGES.map((s, i) => {
                    const done = stage > i;
                    const active = stage === i;
                    return (
                      <motion.div
                        key={s.label}
                        initial={{ opacity: 0.5 }}
                        animate={{ opacity: done || active ? 1 : 0.5 }}
                        className="flex items-start gap-3"
                      >
                        {done ? (
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                        ) : active ? (
                          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-brand" />
                        ) : (
                          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-black/20" />
                        )}
                        <div>
                          <p
                            className={`text-sm font-medium ${
                              done || active ? "text-black" : "text-black/60"
                            }`}
                          >
                            {s.label}
                          </p>
                          <p className="mt-0.5 text-xs leading-snug text-black/60">
                            {s.desc}
                          </p>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>

                {/* Progress bar */}
                <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-black/10">
                  <motion.div
                    animate={{
                      width: `${Math.min((stage / STAGES.length) * 100, 100)}%`,
                    }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                    className="h-full rounded-full bg-brand"
                  />
                </div>
              </div>
            </motion.div>
          )}

          {/* ── Error ──────────────────────────────────────── */}
          {phase === "error" && (
            <motion.div
              key="error"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.3 }}
              className="mt-8 rounded-xl border border-red-200 bg-red-50 p-8 text-center"
            >
              <FileWarning className="mx-auto h-9 w-9 text-red-600" />
              <p className="mt-3 text-sm font-medium text-red-700">
                {errorMsg}
              </p>
              <button
                onClick={reset}
                className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-black px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Try again
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
