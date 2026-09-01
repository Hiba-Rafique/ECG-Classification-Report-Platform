"use client";

import { useCallback, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { UploadCloud, FileWarning, Loader2, CheckCircle2 } from "lucide-react";

type UploadState =
  | { status: "idle" }
  | { status: "uploading" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

const ACCEPT = ".csv,.dat,.hea,.edf";

export default function UploadCard({
  onUploaded,
}: {
  onUploaded: (id: number) => void;
}) {
  const [state, setState] = useState<UploadState>({ status: "idle" });
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    async (fileList: File[]) => {
      if (fileList.length === 0) return;
      setState({ status: "uploading" });
      try {
        const { uploadEcg } = await import("@/lib/api");
        const res = await uploadEcg(fileList);
        setState({
          status: "success",
          message: `Analysis complete — result #${res.id}`,
        });
        onUploaded(res.id);
      } catch (err) {
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "Upload failed",
        });
      }
    },
    [onUploaded]
  );

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="rounded-2xl border border-medical-100 bg-white p-6 shadow-lg shadow-medical-100/50"
    >
      <h2 className="font-display text-lg font-semibold text-slate-900">
        Upload ECG Recording
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        WFDB (select .dat + .hea together), CSV, or EDF — up to 50 MB
      </p>

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
          borderColor: dragging ? "#dc2626" : "#fecaca",
          backgroundColor: dragging ? "#fef2f2" : "#ffffff",
        }}
        whileHover={{ scale: 1.01 }}
        className="ecg-grid mt-5 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 transition-colors"
      >
        <motion.div
          animate={dragging ? { y: [0, -8, 0] } : {}}
          transition={{ repeat: Infinity, duration: 1.2 }}
        >
          {state.status === "uploading" ? (
            <Loader2 className="h-10 w-10 animate-spin text-medical-600" />
          ) : state.status === "error" ? (
            <FileWarning className="h-10 w-10 text-medical-600" />
          ) : state.status === "success" ? (
            <CheckCircle2 className="h-10 w-10 text-emerald-600" />
          ) : (
            <UploadCloud className="h-10 w-10 text-medical-500" />
          )}
        </motion.div>

        <p className="font-medium text-slate-700">
          {state.status === "uploading"
            ? "Analyzing signal…"
            : dragging
              ? "Drop the file to analyze"
              : "Drag & drop your ECG file here"}
        </p>
        <p className="text-xs text-slate-400">or click to browse</p>

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

      <AnimatePresence>
        {state.status === "success" && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700"
          >
            {state.message}
          </motion.p>
        )}
        {state.status === "error" && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-3 rounded-lg bg-medical-50 px-3 py-2 text-sm font-medium text-medical-700"
          >
            {state.message}
          </motion.p>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
