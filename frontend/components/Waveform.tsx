"use client";

import { useEffect, useRef } from "react";
import type { ECGResult } from "@/lib/api";

/**
 * Renders a synthetic 12-lead-style ECG trace on canvas with
 * flagged regions highlighted in translucent red bands.
 * The signal is synthetic (for display) — real waveform rendering
 * will hook into the uploaded signal once the backend exposes it.
 */
export default function Waveform({ result }: { result: ECGResult }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const mid = H / 2;

    // Clear with subtle ECG paper background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);

    // Draw grid
    ctx.strokeStyle = "rgba(220, 38, 38, 0.08)";
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 20) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = 0; y < H; y += 20) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    // ── Synthetic ECG: PQRST via gaussian bumps ──
    const heartRate = 72; // bpm
    const beatInterval = 60 / heartRate; // seconds per beat
    const totalSeconds = 10;
    const samples = 2000;
    const dt = totalSeconds / samples;

    const gaussian = (t: number, mu: number, sigma: number) =>
      Math.exp(-((t - mu) ** 2) / (2 * sigma ** 2));

    const signal: number[] = [];
    for (let i = 0; i < samples; i++) {
      const t = i * dt;
      const phase = t % beatInterval;
      const p = 0.12 * gaussian(phase, 0.16, 0.025); // P wave
      const q = -0.08 * gaussian(phase, 0.255, 0.008); // Q
      const r = 1.0 * gaussian(phase, 0.27, 0.010); // R spike
      const s = -0.15 * gaussian(phase, 0.285, 0.010); // S
      const tWave = 0.25 * gaussian(phase, 0.44, 0.05); // T wave
      const noise = (Math.random() - 0.5) * 0.015;
      signal.push(p + q + r + s + tWave + noise);
    }

    // ── Flagged region bands (deterministic from flags) ──
    const numFlags = Math.max(result.flags.length, 0);
    const bandWidth = W / Math.max(numFlags * 2.5, 8);
    const bands: Array<{ start: number; end: number }> = [];
    for (let i = 0; i < numFlags; i++) {
      const start = ((i + 1) / (numFlags + 1)) * W - bandWidth / 2;
      bands.push({ start, end: start + bandWidth });
    }

    // Draw bands
    bands.forEach((band) => {
      ctx.fillStyle = "rgba(220, 38, 38, 0.12)";
      ctx.fillRect(band.start, 0, band.end - band.start, H);
      ctx.strokeStyle = "rgba(220, 38, 38, 0.4)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(band.start, 0);
      ctx.lineTo(band.start, H);
      ctx.moveTo(band.end, 0);
      ctx.lineTo(band.end, H);
      ctx.stroke();
      ctx.setLineDash([]);
    });

    // Draw signal
    ctx.strokeStyle = "#dc2626";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    const amp = H * 0.32;
    for (let i = 0; i < samples; i++) {
      const x = (i / samples) * W;
      const y = mid - signal[i] * amp;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Flag labels
    ctx.font = "600 11px sans-serif";
    ctx.fillStyle = "#b91c1c";
    bands.forEach((band, i) => {
      const label = result.flags[i]?.slice(0, 18) ?? "";
      ctx.fillText(label, band.start + 4, 14);
    });
  }, [result]);

  return (
    <canvas
      ref={canvasRef}
      width={860}
      height={220}
      className="w-full rounded-xl border border-medical-100 bg-white"
    />
  );
}
