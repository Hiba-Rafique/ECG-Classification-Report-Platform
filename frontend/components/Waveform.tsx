"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Rows3, Maximize2, Activity } from "lucide-react";
import type { ECGResult } from "@/lib/api";
import { formatFlagName } from "@/lib/api";

// ── 12-lead ECG viewer ──────────────────────────────────────
// Realistic synthetic PQRST per lead with DRAMATIC abnormality highlighting:
//   • Red glow halo around flagged signals
//   • Thick red waveform line for abnormal leads
//   • Red background overlay with left accent bar
//   • "⚠ ABNORMAL" badge on flagged cells
//   • Zoom mode: "ABNORMALITY DETECTED" banner + annotation arrow
//   • Toolbar shows which leads are affected

const LEADS = [
  "I", "II", "III", "aVR", "aVL", "aVF",
  "V1", "V2", "V3", "V4", "V5", "V6",
] as const;

const LEAD_GROUPS: { label: string; indices: number[] }[] = [
  { label: "Limb", indices: [0, 1, 2, 3, 4, 5] },
  { label: "Precordial", indices: [6, 7, 8, 9, 10, 11] },
];

// ── Signal generation ─────────────────────────────────────────

const gauss = (x: number, mu: number, s: number) =>
  Math.exp(-((x - mu) ** 2) / (2 * s * s));

type LeadParams = {
  pAmp: number;
  qAmp: number;
  rAmp: number;
  sAmp: number;
  tAmp: number;
  stShift: number;
};

const LEAD_MORPH: Record<string, LeadParams> = {
  I:   { pAmp:  0.08, qAmp: -0.02, rAmp:  0.55, sAmp: -0.05, tAmp:  0.20, stShift: 0 },
  II:  { pAmp:  0.10, qAmp: -0.04, rAmp:  0.85, sAmp: -0.06, tAmp:  0.25, stShift: 0 },
  III: { pAmp:  0.05, qAmp: -0.08, rAmp:  0.35, sAmp: -0.10, tAmp:  0.10, stShift: 0 },
  aVR: { pAmp: -0.06, qAmp:  0.04, rAmp: -0.45, sAmp:  0.08, tAmp: -0.15, stShift: 0 },
  aVL: { pAmp:  0.06, qAmp:  0.00, rAmp:  0.30, sAmp: -0.02, tAmp:  0.15, stShift: 0 },
  aVF: { pAmp:  0.08, qAmp: -0.06, rAmp:  0.60, sAmp: -0.08, tAmp:  0.20, stShift: 0 },
  V1:  { pAmp:  0.04, qAmp:  0.00, rAmp:  0.15, sAmp: -0.75, tAmp: -0.08, stShift: 0 },
  V2:  { pAmp:  0.06, qAmp:  0.00, rAmp:  0.30, sAmp: -0.90, tAmp:  0.12, stShift: 0 },
  V3:  { pAmp:  0.07, qAmp: -0.02, rAmp:  0.50, sAmp: -0.60, tAmp:  0.18, stShift: 0 },
  V4:  { pAmp:  0.08, qAmp: -0.03, rAmp:  0.85, sAmp: -0.30, tAmp:  0.22, stShift: 0 },
  V5:  { pAmp:  0.08, qAmp: -0.04, rAmp:  0.95, sAmp: -0.15, tAmp:  0.25, stShift: 0 },
  V6:  { pAmp:  0.06, qAmp: -0.03, rAmp:  0.70, sAmp: -0.10, tAmp:  0.20, stShift: 0 },
};

function applyAbnormalities(
  flags: string[],
  confidences: number[],
): Partial<Record<string, Partial<LeadParams>>> {
  const mods: Partial<Record<string, Partial<LeadParams>>> = {};
  const add = (lead: string, mod: Partial<LeadParams>) => {
    mods[lead] = { ...mods[lead], ...mod };
  };

  for (const [flag, conf] of flags.map((f, i) => [f, confidences[i]] as const)) {
    if (conf < 0.2) continue;
    const scale = Math.min(conf / 0.6, 1);
    switch (flag) {
      case "myocardial_infarction":
        add("V1", { stShift: 0.18 * scale });
        add("V2", { stShift: 0.22 * scale });
        add("V3", { stShift: 0.20 * scale });
        add("V4", { stShift: 0.12 * scale });
        add("II", { stShift: 0.08 * scale });
        add("III", { stShift: 0.10 * scale });
        add("aVF", { stShift: 0.08 * scale });
        break;
      case "conduction_defect":
        for (const l of ["V1", "V2", "I", "aVL"] as const) {
          const m = LEAD_MORPH[l];
          add(l, { rAmp: m.rAmp * 0.7, sAmp: m.sAmp * 1.4 });
        }
        break;
      case "hypertrophy":
        add("V5", { rAmp: 1.30 });
        add("V6", { rAmp: 1.10 });
        add("I", { rAmp: 0.80 });
        add("aVL", { rAmp: 0.55 });
        break;
      case "st_t_abnormality":
        add("V4", { tAmp: -0.18, stShift: -0.06 });
        add("V5", { tAmp: -0.15, stShift: -0.05 });
        add("II", { tAmp: -0.12 });
        add("III", { tAmp: -0.10 });
        break;
    }
  }
  return mods;
}

function generateSignal(lead: string, samples: number, bpm: number): number[] {
  const base = LEAD_MORPH[lead] ?? LEAD_MORPH.II;
  const beatSec = 60 / bpm;
  const sig: number[] = [];

  for (let i = 0; i < samples; i++) {
    const t = (i / samples) * 10;
    const phase = t % beatSec;
    const noise = (Math.random() - 0.5) * 0.012;

    const p = gauss(phase, beatSec * 0.18, 0.028) * base.pAmp;
    const q = gauss(phase, beatSec * 0.28, 0.009) * base.qAmp;
    const r = gauss(phase, beatSec * 0.30, 0.011) * base.rAmp;
    const s = gauss(phase, beatSec * 0.32, 0.011) * base.sAmp;
    const tw = gauss(phase, beatSec * 0.50, 0.048) * base.tAmp;

    sig.push(p + q + r + s + tw + base.stShift + noise);
  }
  return sig;
}

// ── Canvas rendering ──────────────────────────────────────────

function drawECG(
  canvas: HTMLCanvasElement,
  result: ECGResult,
  mode: "all" | "zoom",
  selectedLead: string | null,
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

  // Background
  ctx.fillStyle = "#fafbfd";
  ctx.fillRect(0, 0, W, H);

  // Abnormality mods + flagged leads set
  const abnMods = applyAbnormalities(
    result.flags ?? [],
    result.confidence_scores ?? [],
  );
  const flaggedSet = new Set<string>();
  for (const flag of result.flags ?? []) {
    if (flag === "myocardial_infarction") {
      ["V1", "V2", "V3", "V4", "II", "III", "aVF"].forEach((l) => flaggedSet.add(l));
    } else if (flag === "conduction_defect") {
      ["V1", "V2", "I", "aVL"].forEach((l) => flaggedSet.add(l));
    } else if (flag === "hypertrophy") {
      ["V5", "V6", "I", "aVL"].forEach((l) => flaggedSet.add(l));
    } else if (flag === "st_t_abnormality") {
      ["V4", "V5", "II", "III"].forEach((l) => flaggedSet.add(l));
    }
  }

  const bpm = 72 + (result.id % 7) - 3;
  const samples = mode === "zoom" ? 1000 : 2000;

  // Generate signals
  const signals: Record<string, number[]> = {};
  for (const lead of LEADS) {
    const base = LEAD_MORPH[lead];
    const mod = abnMods[lead] ?? {};
    const morph = { ...base, ...mod };
    const origMorph = LEAD_MORPH[lead];
    LEAD_MORPH[lead] = morph;
    signals[lead] = generateSignal(lead, samples, bpm);
    LEAD_MORPH[lead] = origMorph;
  }

  // ── Drawing helpers ──

  const drawGrid = (
    x: number, y: number, w: number, h: number,
    flagged: boolean,
  ) => {
    // Flagged background tint
    if (flagged) {
      ctx.fillStyle = "rgba(239, 68, 68, 0.04)";
      ctx.fillRect(x, y, w, h);
    }

    // Small grid
    ctx.strokeStyle = flagged
      ? "rgba(239,68,68,0.06)"
      : "rgba(99,102,241,0.04)";
    ctx.lineWidth = 0.5;
    for (let gx = x; gx <= x + w; gx += 5) {
      ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx, y + h); ctx.stroke();
    }
    for (let gy = y; gy <= y + h; gy += 5) {
      ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x + w, gy); ctx.stroke();
    }
    // Large grid
    ctx.strokeStyle = flagged
      ? "rgba(239,68,68,0.12)"
      : "rgba(99,102,241,0.08)";
    for (let gx = x; gx <= x + w; gx += 25) {
      ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx, y + h); ctx.stroke();
    }
    for (let gy = y; gy <= y + h; gy += 25) {
      ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x + w, gy); ctx.stroke();
    }
  };

  /**
   * Draw a signal trace.
   * Flagged leads get: red fill + left accent bar + red glow + red line +
   * "⚠ ABNORMAL" badge (in "all" mode).
   */
  const drawSignal = (
    sig: number[],
    x: number, y: number, w: number, h: number,
    amp: number, showAnnotation: boolean,
  ) => {
    const endSample = Math.floor(sig.length * animProgress);

    // ── Flagged: red background + accent bar ──
    if (showAnnotation) {
      ctx.fillStyle = "rgba(239, 68, 68, 0.07)";
      ctx.fillRect(x, y, w, h);

      // Left accent bar
      ctx.fillStyle = "#ef4444";
      ctx.fillRect(x, y, 3, h);
    }

    // ── Signal line ──
    const sigColor = showAnnotation ? "#ef4444" : "#1e293b";
    ctx.strokeStyle = sigColor;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    if (showAnnotation) {
      // Glow layer (wider, semi-transparent red)
      ctx.save();
      ctx.strokeStyle = "rgba(239, 68, 68, 0.22)";
      ctx.lineWidth = mode === "zoom" ? 8 : 5;
      ctx.beginPath();
      for (let i = 0; i < endSample; i++) {
        const px = x + (i / sig.length) * w;
        const py = y + h / 2 - sig[i] * amp;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.restore();

      // Main red line
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = mode === "zoom" ? 2.5 : 1.8;
    } else {
      ctx.lineWidth = mode === "zoom" ? 2 : 1.2;
    }

    ctx.strokeStyle = sigColor;
    ctx.beginPath();
    for (let i = 0; i < endSample; i++) {
      const px = x + (i / sig.length) * w;
      const py = y + h / 2 - sig[i] * amp;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // ── "⚠ ABNORMAL" badge (all mode only) ──
    if (showAnnotation && mode === "all" && animProgress > 0.6) {
      ctx.font = "bold 8px ui-sans-serif, system-ui, sans-serif";
      const text = "\u26A0 ABNORMAL";
      const tw = ctx.measureText(text).width;
      const bx = x + w - tw - 12;
      const by = y + 2;
      ctx.fillStyle = "rgba(239, 68, 68, 0.92)";
      ctx.beginPath();
      ctx.roundRect(bx, by, tw + 8, 14, 3);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillText(text, bx + 4, by + 10.5);
    }
  };

  // ── Layout ──

  if (mode === "all") {
    const padX = 8, padY = 8;
    const gapX = 6, gapY = 6;
    const cellW = (W - padX * 2 - gapX * 3) / 4;
    const cellH = (H - padY * 2 - gapY * 2 - 50) / 3;
    const rhythmH = 44;
    const rhythmY = H - padY - rhythmH;

    const grid = [
      [LEADS[0], LEADS[3], LEADS[6], LEADS[9]],
      [LEADS[1], LEADS[4], LEADS[7], LEADS[10]],
      [LEADS[2], LEADS[5], LEADS[8], LEADS[11]],
    ];

    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 4; col++) {
        const lead = grid[row][col];
        const cx = padX + col * (cellW + gapX);
        const cy = padY + row * (cellH + gapY);
        const isFl = flaggedSet.has(lead);

        drawGrid(cx, cy, cellW, cellH, isFl);

        // Lead label
        ctx.font = "bold 10px ui-monospace, monospace";
        ctx.fillStyle = isFl ? "#ef4444" : "#6366f1";
        ctx.fillText(lead, cx + 3, cy + 12);

        drawSignal(signals[lead], cx, cy, cellW, cellH, cellH * 0.28, isFl);
      }
    }

    // Rhythm strip
    drawGrid(padX, rhythmY, W - padX * 2, rhythmH, false);
    ctx.font = "bold 10px ui-monospace, monospace";
    ctx.fillStyle = "#6366f1";
    ctx.fillText("II", padX + 3, rhythmY + 12);

    ctx.strokeStyle = "#6366f1";
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    const rhythmSig = signals.II;
    const rhythmEnd = Math.floor(rhythmSig.length * animProgress);
    ctx.beginPath();
    for (let i = 0; i < rhythmEnd; i++) {
      const px = padX + (i / rhythmSig.length) * (W - padX * 2);
      const py = rhythmY + rhythmH / 2 - rhythmSig[i] * rhythmH * 0.32;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();

  } else {
    // ── Zoom mode ──
    const lead = selectedLead ?? "II";
    const padX = 16, padY = 36;
    const sigH = H - padY - 50;

    const isFl = flaggedSet.has(lead);

    drawGrid(padX, padY, W - padX * 2, sigH, isFl);

    // ── "ABNORMALITY DETECTED" banner ──
    if (isFl && animProgress > 0.3) {
      const bannerH = 24;
      ctx.fillStyle = "#ef4444";
      ctx.fillRect(padX, padY - bannerH - 4, W - padX * 2, bannerH);

      ctx.font = "bold 11px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "#ffffff";
      ctx.fillText(
        "\u26A0  ABNORMALITY DETECTED \u2014 " +
          (result.flags ?? []).map(formatFlagName).join(", "),
        padX + 10,
        padY - bannerH + 13,
      );
    }

    // Lead label
    ctx.font = "bold 14px ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle = isFl ? "#ef4444" : "#312e81";
    ctx.fillText(`Lead ${lead}`, padX + 4, padY - (isFl ? 30 : 8));

    // Time markers
    ctx.font = "9px ui-monospace, monospace";
    ctx.fillStyle = "#94a3b8";
    for (let s = 0; s <= 10; s += 1) {
      const tx = padX + (s / 10) * (W - padX * 2);
      ctx.fillText(`${s}s`, tx, H - 6);
    }

    // Calibration bar
    ctx.strokeStyle = "#312e81";
    ctx.lineWidth = 1.5;
    const calX = W - padX - 24;
    const calY = padY + 10;
    const calH = sigH * 0.18;
    ctx.beginPath();
    ctx.moveTo(calX, calY); ctx.lineTo(calX, calY + calH);
    ctx.stroke();
    ctx.font = "8px ui-monospace, monospace";
    ctx.fillStyle = "#6366f1";
    ctx.fillText("1mV", calX - 6, calY - 3);

    // Draw signal
    drawSignal(signals[lead], padX, padY, W - padX * 2, sigH, sigH * 0.35, isFl);

    // ── Annotation arrow (zoom flagged) ──
    if (isFl && animProgress > 0.7) {
      const arrowX = padX + (W - padX * 2) * 0.35;
      const arrowY = padY + sigH * 0.12;
      ctx.fillStyle = "#ef4444";
      ctx.beginPath();
      ctx.moveTo(arrowX, arrowY);
      ctx.lineTo(arrowX - 5, arrowY - 10);
      ctx.lineTo(arrowX + 5, arrowY - 10);
      ctx.closePath();
      ctx.fill();

      ctx.font = "bold 10px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "#ef4444";
      ctx.fillText("\u2191 Abnormal region", arrowX + 8, arrowY - 2);
    }
  }
}

// ── Component ─────────────────────────────────────────────────

export default function Waveform({ result }: { result: ECGResult }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"all" | "zoom">("all");
  const [selectedLead, setSelectedLead] = useState<string>("II");
  const [animProgress, setAnimProgress] = useState(0);

  const hasFlags = (result.flags?.length ?? 0) > 0;

  // Build flagged leads set (used in JSX for lead selector styling)
  const flaggedLeads = new Set<string>();
  for (const flag of result.flags ?? []) {
    if (flag === "myocardial_infarction") {
      ["V1","V2","V3","V4","II","III","aVF"].forEach((l) => flaggedLeads.add(l));
    } else if (flag === "conduction_defect") {
      ["V1","V2","I","aVL"].forEach((l) => flaggedLeads.add(l));
    } else if (flag === "hypertrophy") {
      ["V5","V6","I","aVL"].forEach((l) => flaggedLeads.add(l));
    } else if (flag === "st_t_abnormality") {
      ["V4","V5","II","III"].forEach((l) => flaggedLeads.add(l));
    }
  }

  const primaryFlagLead = (() => {
    if (!hasFlags) return "II";
    const flag = result.flags[0];
    if (flag === "myocardial_infarction") return "V2";
    if (flag === "conduction_defect") return "V1";
    if (flag === "hypertrophy") return "V5";
    if (flag === "st_t_abnormality") return "V4";
    return "II";
  })();

  // Animate signal drawing
  useEffect(() => {
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
  }, [result.id, mode, selectedLead]);

  // Draw canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawECG(canvas, result, mode, selectedLead, animProgress);
  }, [result, mode, selectedLead, animProgress]);

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      if (canvasRef.current) {
        drawECG(canvasRef.current, result, mode, selectedLead, animProgress);
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [result, mode, selectedLead, animProgress]);

  const switchMode = (newMode: "all" | "zoom") => {
    setMode(newMode);
    if (newMode === "zoom") setSelectedLead(primaryFlagLead);
  };

  // Build list of affected leads for toolbar display
  const affectedLeads = hasFlags
    ? LEADS.filter((l) => {
        for (const flag of result.flags ?? []) {
          if (flag === "myocardial_infarction" && ["V1","V2","V3","V4","II","III","aVF"].includes(l)) return true;
          if (flag === "conduction_defect" && ["V1","V2","I","aVL"].includes(l)) return true;
          if (flag === "hypertrophy" && ["V5","V6","I","aVL"].includes(l)) return true;
          if (flag === "st_t_abnormality" && ["V4","V5","II","III"].includes(l)) return true;
        }
        return false;
      })
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
                ? "bg-indigo-600 text-white shadow-sm"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            <Rows3 className="h-3.5 w-3.5" />
            12-Lead
          </button>
          <button
            onClick={() => switchMode("zoom")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
              mode === "zoom"
                ? "bg-indigo-600 text-white shadow-sm"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            <Maximize2 className="h-3.5 w-3.5" />
            Detail
          </button>
        </div>

        {hasFlags && (
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-600 ring-1 ring-red-200">
              <Activity className="h-3 w-3" />
              {affectedLeads.length} lead{affectedLeads.length !== 1 ? "s" : ""} affected
            </span>
          </div>
        )}
      </div>

      {/* Canvas */}
      <div className={`relative overflow-hidden rounded-xl border bg-white shadow-sm transition-shadow ${
        hasFlags ? "border-red-200 shadow-red-100/50 ring-1 ring-red-100" : "border-indigo-100"
      }`}>
        <canvas
          ref={canvasRef}
          className="h-[280px] w-full sm:h-[340px] lg:h-[380px]"
        />

        {/* Calibration overlay */}
        <div className="pointer-events-none absolute bottom-2 right-3 flex items-center gap-2 text-[10px] text-slate-400">
          <span>500 Hz</span>
          <span>·</span>
          <span>10 mm/mV</span>
          <span>·</span>
          <span>25 mm/s</span>
        </div>

        {/* Flagged leads legend */}
        {hasFlags && affectedLeads.length > 0 && (
          <div className="pointer-events-none absolute bottom-2 left-3 flex items-center gap-1.5 text-[10px]">
            <span className="inline-block h-2 w-2 rounded-sm bg-red-500" />
            <span className="text-red-500 font-medium">
              {affectedLeads.join(", ")}
            </span>
          </div>
        )}
      </div>

      {/* Lead selector (zoom mode) */}
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
                  <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    {group.label}
                  </span>
                  {group.indices.map((idx) => {
                    const lead = LEADS[idx];
                    const isSel = lead === selectedLead;
                    const isFlagged = flaggedLeads.has(lead);
                    return (
                      <button
                        key={lead}
                        onClick={() => setSelectedLead(lead)}
                        className={`relative rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                          isSel
                            ? "bg-indigo-600 text-white shadow-sm"
                            : isFlagged
                              ? "bg-red-50 text-red-700 ring-1 ring-red-200 hover:bg-red-100"
                              : "bg-slate-50 text-slate-600 hover:bg-slate-100"
                        }`}
                      >
                        {lead}
                        {isFlagged && !isSel && (
                          <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-red-500" />
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
