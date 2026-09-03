"use client";

import { motion } from "framer-motion";

/**
 * Animated ECG trace used as a hero/backdrop element.
 * The path is drawn once per cycle via stroke-dashoffset animation.
 */
export default function EcgLine({
  className = "",
  height = 60,
}: {
  className?: string;
  height?: number;
}) {
  return (
    <svg
      viewBox="0 0 600 100"
      className={className}
      style={{ height }}
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <linearGradient id="ecg-grad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#6366f1" stopOpacity="0" />
          <stop offset="20%" stopColor="#6366f1" stopOpacity="1" />
          <stop offset="100%" stopColor="#6366f1" stopOpacity="1" />
        </linearGradient>
      </defs>
      <motion.path
        d="M0,50 L80,50 L95,50 L105,35 L115,65 L125,50 L200,50 L215,50 L225,20 L235,80 L245,50 L320,50 L335,50 L345,35 L355,65 L365,50 L440,50 L455,50 L465,20 L475,80 L485,50 L600,50"
        fill="none"
        stroke="url(#ecg-grad)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 2.6, repeat: Infinity, ease: "linear" }}
      />
    </svg>
  );
}
