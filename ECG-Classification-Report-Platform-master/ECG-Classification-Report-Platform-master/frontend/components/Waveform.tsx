"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Rows3, Maximize2, Activity } from "lucide-react";
import type { ECGResult, ECGSignal } from "@/lib/api";
import { formatFlagName } from "@/lib/api";

// ── 12-lead ECG viewer — renders the REAL recorded signal ─────────
// The trace comes from GET /api/results/:id/signal: the backend loads the
// stored upload (WFDB via the wfdb library, CSV, or EDF), bandpass-filters
// it exactly as the classifier sees it, and decimates to ~250 Hz.
//
// Rendering is physically calibrated like paper ECG:
//   • 25 mm/s sweep · 10 mm/mV gain
//   • 1 mm small grid (0.04 s × 0.1 mV) + 5 mm bold grid (0.2 s × 0.5 mV)
//   • Classic layout: 12 leads at 2.5 s each + full-length lead II rhythm
//     strip, with time ticks and a 1 mV calibration pulse in Detail mode
// Flagged leads keep the dramatic red treatment (glow, badges, banner).

const DEFAULT_LEADS = [
  "I", "II", "III", "aVR", "aVL", "aVF",
  "V1", "V2", "V3", "V4", "V5", "V6",
];

const LEAD_GROUPS: { label: string; indices: number[] }[] = [
  { label: "Limb", indices: [0, 1, 2, 3, 4, 5] },
  { label: "Precordial", indices: [6, 7, 8, 9, 10, 11] },
];

// Standard paper calibration
const MM_PER_SEC = 25;
const MM_PER_MV = 10;
const TILE_SECONDS = 2.5; // each 12-lead tile shows the first 2.5 s

// Heuristic display aid: which leads a flagged superclass typically
// manifests in (flags are the five superclass codes NORM/MI/STTC/CD/HYP)
const FLAG_TO_LEADS: Record<string, string[]> = {
  NORM: [],
  MI: ["V1", "V2", "V3", "V4", "II", "III", "aVF"],
  STTC: ["V4", "V5", "II", "III"],
  CD: ["V1", "V2", "I", "aVL"],
  HYP: ["V5", "V6", "I", "aVL"],
};

function flaggedLeadsFor(flags: string[]): Set<string> {
  const set = new Set<string>();
  for (const flag of flags) {
    for (const lead of FLAG_TO_LEADS[flag] ?? []) set.add(lead);
  }
  return set;
}

// Robust baseline estimate over a subsample (for centering traces)
function quickMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function leadMedians(signal: ECGSignal): number[] {
  return signal.leads.map((lead) => {
    const stride: number[] = [];
    for (let i = 0; i < lead.length; i += 25) stride.push(lead[i]);
    return quickMedian(stride);
  });
}

// ── Canvas rendering ──────────────────────────────────────────

function drawECG(
  canvas: HTMLCanvasElement,
  result: ECGResult,
  signal: ECGSignal | null,
  signalFailed: boolean,
  mode: "all" | "zoom",
  selectedLead: string,
  animProgress: number,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  // Paper background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  const leadNames =
    signal && signal.lead_names.length === 12
      ? signal.lead_names
      : DEFAULT_LEADS;
  const flaggedSet = flaggedLeadsFor(result.flags ?? []);
  const medians = signal ? leadMedians(signal) : [];

  // ── ECG paper grid ─────────────────────────────────────────
  const drawPaper = (
    x: number, y: number, w: number, h: number,
    pxPerMm: number, flagged: boolean,
  ) => {
    if (flagged) {
      ctx.fillStyle = "rgba(217, 4, 41, 0.05)";
      ctx.fillRect(x, y, w, h);
    }

    const small = pxPerMm;      // 1 mm  = 0.04 s × 0.1 mV
    const large = pxPerMm * 5;  // 5 mm  = 0.2 s × 0.5 mV

    // Small squares — only when they are at least ~2.5 px apart
    if (small >= 2.4) {
      ctx.strokeStyle = flagged
        ? "rgba(217, 4, 41, 0.16)"
        : "rgba(217, 4, 41, 0.13)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let gx = x + small; gx < x + w - 0.5; gx += small) {
        ctx.moveTo(gx, y); ctx.lineTo(gx, y + h);
      }
      for (let gy = y + small; gy < y + h - 0.5; gy += small) {
        ctx.moveTo(x, gy); ctx.lineTo(x + w, gy);
      }
      ctx.stroke();
    }

    // Bold 5 mm squares
    ctx.strokeStyle = flagged
      ? "rgba(217, 4, 41, 0.32)"
      : "rgba(217, 4, 41, 0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gx = x; gx <= x + w + 0.5; gx += large) {
      ctx.moveTo(gx, y); ctx.lineTo(gx, y + h);
    }
    for (let gy = y; gy <= y + h + 0.5; gy += large) {
      ctx.moveTo(x, gy); ctx.lineTo(x + w, gy);
    }
    ctx.stroke();
  };

  // Snap the 0 mV baseline onto a bold 5 mm grid line
  const baselineOffset = (h: number, pxPerMm: number) => {
    const large = pxPerMm * 5;
    return Math.round(h / 2 / large) * large;
  };

  // ── Signal trace ───────────────────────────────────────────
  const drawTrace = (
    data: number[],
    offsetMv: number,
    x: number, y: number, w: number, h: number,
    pxPerMm: number,
    t0: number, t1: number,
    flagged: boolean,
    lineWidth: number,
  ) => {
    if (!signal) return;
    const fs = signal.signal_fs;
    const gain = pxPerMm * MM_PER_MV; // px per mV
    const baselineY = y + baselineOffset(h, pxPerMm);

    const i0 = Math.max(0, Math.floor(t0 * fs));
    const i1 = Math.min(data.length, Math.ceil(t1 * fs));
    if (i1 <= i0) return;
    const endI = i0 + Math.floor((i1 - i0) * animProgress);

    const trace = () => {
      ctx.beginPath();
      for (let i = i0; i < endI; i++) {
        const px = x + ((i / fs - t0) / (t1 - t0)) * w;
        const py = baselineY - (data[i] - offsetMv) * gain;
        if (i === i0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
    };

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();

    if (flagged) {
      ctx.fillStyle = "rgba(217, 4, 41, 0.07)";
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = "#d90429";
      ctx.fillRect(x, y, 3, h);
    }

    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    if (flagged) {
      // Glow layer (wider, semi-transparent red)
      ctx.save();
      ctx.strokeStyle = "rgba(217, 4, 41, 0.20)";
      ctx.lineWidth = lineWidth * 3.2;
      trace();
      ctx.stroke();
      ctx.restore();
    }

    ctx.strokeStyle = flagged ? "#d90429" : "#000000";
    ctx.lineWidth = lineWidth;
    trace();
    ctx.stroke();
    ctx.restore();
  };

  // ── 1 mV calibration pulse (classic L shape) ──────────────
  const drawCalPulse = (x: number, baselineY: number, pxPerMm: number, color = "#000000") => {
    const gain = pxPerMm * MM_PER_MV;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, baselineY);
    ctx.lineTo(x, baselineY - gain);               // up 1 mV
    ctx.lineTo(x + pxPerMm * 5, baselineY - gain); // across 0.2 s
    ctx.lineTo(x + pxPerMm * 5, baselineY);
    ctx.stroke();
  };

  // ── Placeholder while / if the signal is unavailable ───────
  if (!signal) {
    if (mode === "all") {
      drawPaper(8, 8, W - 16, H - 16, 3.4, false);
    }
    ctx.font = "600 12px Inter, ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle = "#64748b";
    const msg = signalFailed ? "Signal unavailable" : "Loading signal…";
    const tw = ctx.measureText(msg).width;
    ctx.fillText(msg, (W - tw) / 2, H / 2);
    return;
  }

  const duration = signal.duration_s || 10;

  if (mode === "all") {
    // ── Classic 12-lead printout: 4 × 3 tiles at 2.5 s + rhythm strip ──
    const padX = 8, padY = 8, gapX = 6, gapY = 6;
    const rhythmH = 52;
    const cellW = (W - padX * 2 - gapX * 3) / 4;
    const cellH = (H - padY * 2 - gapY * 2 - rhythmH - 8) / 3;
    const rhythmY = H - padY - rhythmH;

    const tileSec = Math.min(TILE_SECONDS, duration);
    const tilePxPerMm = cellW / (tileSec * MM_PER_SEC);

    const grid = [
      [0, 3, 6, 9],
      [1, 4, 7, 10],
      [2, 5, 8, 11],
    ];

    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 4; col++) {
        const idx = grid[row][col];
        const lead = leadNames[idx];
        const isFl = flaggedSet.has(lead);
        const cx = padX + col * (cellW + gapX);
        const cy = padY + row * (cellH + gapY);

        drawPaper(cx, cy, cellW, cellH, tilePxPerMm, isFl);

        // Lead label
        ctx.font = "bold 10px ui-monospace, monospace";
        ctx.fillStyle = isFl ? "#d90429" : "#000000";
        ctx.fillText(lead, cx + 4, cy + 12);

        drawTrace(
          signal.leads[idx] ?? [], medians[idx] ?? 0,
          cx, cy, cellW, cellH, tilePxPerMm,
          0, tileSec, isFl, 1.4,
        );

        // ⚠ ABNORMAL badge
        if (isFl && animProgress > 0.6) {
          ctx.font = "bold 8px Inter, ui-sans-serif, system-ui, sans-serif";
          const text = "\u26A0 ABNORMAL";
          const tw = ctx.measureText(text).width;
          const bx = cx + cellW - tw - 12;
          const by = cy + 2;
          ctx.fillStyle = "rgba(217, 4, 41, 0.92)";
          ctx.beginPath();
          ctx.roundRect(bx, by, tw + 8, 14, 3);
          ctx.fill();
          ctx.fillStyle = "#fff";
          ctx.fillText(text, bx + 4, by + 10.5);
        }
      }
    }

    // ── Rhythm strip: lead II across the full recording ──
    const rhythmIdx = Math.max(leadNames.indexOf("II"), 0);
    const rhythmLead = leadNames[rhythmIdx];
    const rhythmFl = flaggedSet.has(rhythmLead);
    const rhythmPxPerMm = (W - padX * 2) / (duration * MM_PER_SEC);

    drawPaper(padX, rhythmY, W - padX * 2, rhythmH, rhythmPxPerMm, rhythmFl);

    ctx.font = "bold 10px ui-monospace, monospace";
    ctx.fillStyle = rhythmFl ? "#d90429" : "#000000";
    ctx.fillText(
      `${rhythmLead} · ${Math.round(duration)} s`,
      padX + 4, rhythmY + 12,
    );

    // Time ticks (every second)
    ctx.font = "8px ui-monospace, monospace";
    ctx.fillStyle = "#64748b";
    for (let s = 0; s <= Math.floor(duration); s++) {
      const tx = padX + (s / duration) * (W - padX * 2);
      ctx.fillText(`${s}s`, Math.min(tx, W - padX - 14), rhythmY + rhythmH - 3);
    }

    drawTrace(
      signal.leads[rhythmIdx] ?? [], medians[rhythmIdx] ?? 0,
      padX, rhythmY, W - padX * 2, rhythmH, rhythmPxPerMm,
      0, duration, rhythmFl, 1.6,
    );
  } else {
    // ── Detail: one lead, full recording, paper-accurate scale ──
    let idx = leadNames.indexOf(selectedLead);
    if (idx < 0) idx = Math.max(leadNames.indexOf("II"), 0);
    const lead = leadNames[idx];
    const isFl = flaggedSet.has(lead);

    const padX = 14, padY = 34;
    const sigH = H - padY - 30;
    const pxPerMm = (W - padX * 2) / (duration * MM_PER_SEC);
    const baselineY = padY + baselineOffset(sigH, pxPerMm);

    drawPaper(padX, padY, W - padX * 2, sigH, pxPerMm, isFl);

    // ⚠ ABNORMALITY DETECTED banner
    if (isFl && animProgress > 0.3) {
      const bannerH = 24;
      ctx.fillStyle = "#d90429";
      ctx.fillRect(padX, padY - bannerH - 4, W - padX * 2, bannerH);
      ctx.font = "bold 11px Inter, ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "#ffffff";
      ctx.fillText(
        "\u26A0  ABNORMALITY DETECTED \u2014 " +
          (result.flags ?? []).map(formatFlagName).join(", "),
        padX + 10,
        padY - bannerH + 13,
      );
    }

    // Lead label
    ctx.font = "bold 14px Inter, ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle = isFl ? "#d90429" : "#000000";
    ctx.fillText(`Lead ${lead}`, padX + 4, padY - (isFl ? 30 : 10));

    // Time markers every 1 s
    ctx.font = "9px ui-monospace, monospace";
    ctx.fillStyle = "#64748b";
    for (let s = 0; s <= Math.floor(duration); s++) {
      const tx = padX + (s / duration) * (W - padX * 2);
      ctx.fillText(`${s}s`, Math.min(tx, W - padX - 12), H - 8);
    }

    // mV reference labels on the right edge
    for (const mv of [2, 1, 0, -1, -2]) {
      const ty = baselineY - mv * pxPerMm * MM_PER_MV;
      if (ty > padY + 12 && ty < padY + sigH - 4) {
        ctx.fillText(
          mv === 0 ? "0 mV" : `${mv > 0 ? "+" : ""}${mv} mV`,
          W - padX - 36,
          ty - 2,
        );
      }
    }

    // Calibration pulse (1 mV · 0.2 s), floating top-right of the plot
    drawCalPulse(
      W - padX - pxPerMm * 11,
      padY + pxPerMm * 12,
      pxPerMm,
      isFl ? "#d90429" : "#000000",
    );

    // Trace
    drawTrace(
      signal.leads[idx] ?? [], medians[idx] ?? 0,
      padX, padY, W - padX * 2, sigH, pxPerMm,
      0, duration, isFl, 2,
    );

    // Annotation arrow
    if (isFl && animProgress > 0.7) {
      const arrowX = padX + (W - padX * 2) * 0.35;
      const arrowY = padY + sigH * 0.12;
      ctx.fillStyle = "#d90429";
      ctx.beginPath();
      ctx.moveTo(arrowX, arrowY);
      ctx.lineTo(arrowX - 5, arrowY - 10);
      ctx.lineTo(arrowX + 5, arrowY - 10);
      ctx.closePath();
      ctx.fill();
      ctx.font = "bold 10px Inter, ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "#d90429";
      ctx.fillText("\u2191 Abnormal region", arrowX + 8, arrowY - 2);
    }
  }
}

// ── Component ─────────────────────────────────────────────────

export default function Waveform({
  result,
  signal,
  signalFailed = false,
}: {
  result: ECGResult;
  signal: ECGSignal | null;
  signalFailed?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"all" | "zoom">("all");
  const [selectedLead, setSelectedLead] = useState<string>("II");
  const [animProgress, setAnimProgress] = useState(0);

  const hasFlags = (result.flags?.length ?? 0) > 0;
  const flaggedLeads = flaggedLeadsFor(result.flags ?? []);
  const leadNames =
    signal && signal.lead_names.length === 12
      ? signal.lead_names
      : DEFAULT_LEADS;

  const primaryFlagLead = (() => {
    const fallback = leadNames.includes("II") ? "II" : leadNames[1] ?? leadNames[0];
    if (!hasFlags) return fallback;
    const flag = result.flags[0];
    const candidate =
      flag === "myocardial_infarction" ? "V2"
      : flag === "conduction_defect" ? "V1"
      : flag === "hypertrophy" ? "V5"
      : flag === "st_t_abnormality" ? "V4"
      : "II";
    return leadNames.includes(candidate) ? candidate : fallback;
  })();

  // Animate signal drawing (sweep) once the real signal is available
  useEffect(() => {
    if (!signal) return;
    setAnimProgress(0);
    const start = performance.now();
    const duration = 800;
    let raf: number;
    const animate = (now: number) => {
      const p = Math.min((now - start) / duration, 1);
      setAnimProgress(p);
      if (p < 1) raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [result.id, mode, selectedLead, signal]);

  // Draw canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawECG(canvas, result, signal, signalFailed, mode, selectedLead, animProgress);
  }, [result, signal, signalFailed, mode, selectedLead, animProgress]);

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      if (canvasRef.current) {
        drawECG(canvasRef.current, result, signal, signalFailed, mode, selectedLead, animProgress);
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [result, signal, signalFailed, mode, selectedLead, animProgress]);

  const switchMode = (newMode: "all" | "zoom") => {
    setMode(newMode);
    if (newMode === "zoom") setSelectedLead(primaryFlagLead);
  };

  const affectedLeads = hasFlags
    ? leadNames.filter((l) => flaggedLeads.has(l))
    : [];

  return (
    <div ref={containerRef} className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => switchMode("all")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
              mode === "all"
                ? "bg-black text-white shadow-sm"
                : "bg-black/10 text-black hover:bg-black/20"
            }`}
          >
            <Rows3 className="h-3.5 w-3.5" />
            12-Lead
          </button>
          <button
            onClick={() => switchMode("zoom")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
              mode === "zoom"
                ? "bg-black text-white shadow-sm"
                : "bg-black/10 text-black hover:bg-black/20"
            }`}
          >
            <Maximize2 className="h-3.5 w-3.5" />
            Detail
          </button>
        </div>

        {hasFlags && (
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 rounded-full bg-brand/10 px-2.5 py-1 text-[11px] font-semibold text-red-700 ring-1 ring-brand/30">
              <Activity className="h-3 w-3" />
              {affectedLeads.length} lead{affectedLeads.length !== 1 ? "s" : ""} affected
            </span>
          </div>
        )}
      </div>

      {/* Canvas */}
      <div className={`relative overflow-hidden rounded-xl border bg-white shadow-sm transition-shadow ${
        hasFlags ? "border-brand/40 shadow-brand/10 ring-1 ring-brand/20" : "border-black/10"
      }`}>
        <canvas
          ref={canvasRef}
          className="h-[300px] w-full sm:h-[360px] lg:h-[400px]"
        />

        {/* Calibration overlay */}
        <div className="pointer-events-none absolute bottom-2 right-3 flex items-center gap-2 text-[10px] text-black/60">
          <span>{signal ? `${signal.fs} Hz` : "—"}</span>
          <span>·</span>
          <span>10 mm/mV</span>
          <span>·</span>
          <span>25 mm/s</span>
        </div>

        {/* Flagged leads legend */}
        {hasFlags && affectedLeads.length > 0 && (
          <div className="pointer-events-none absolute bottom-2 left-3 flex items-center gap-1.5 text-[10px]">
            <span className="inline-block h-2 w-2 rounded-sm bg-brand" />
            <span className="text-red-600 font-medium">
              {affectedLeads.join(", ")}
            </span>
          </div>
        )}
      </div>

      {/* Lead selector (detail mode) */}
      <AnimatePresence>
        {mode === "zoom" && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="flex flex-wrap gap-1.5">
              {LEAD_GROUPS.map((group) => (
                <div key={group.label} className="flex items-center gap-1">
                  <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-black/60">
                    {group.label}
                  </span>
                  {group.indices.map((idx) => {
                    const lead = leadNames[idx];
                    const isSel = lead === selectedLead;
                    const isFlagged = flaggedLeads.has(lead);
                    return (
                      <button
                        key={lead}
                        onClick={() => setSelectedLead(lead)}
                        className={`relative rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                          isSel
                            ? "bg-black text-white shadow-sm"
                            : isFlagged
                              ? "bg-brand/10 text-red-700 ring-1 ring-brand/30 hover:bg-brand/20"
                              : "bg-black/5 text-black hover:bg-black/15"
                        }`}
                      >
                        {lead}
                        {isFlagged && !isSel && (
                          <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-brand" />
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
