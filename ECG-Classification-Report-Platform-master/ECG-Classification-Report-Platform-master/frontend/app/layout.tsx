import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CardioLens — ECG Analysis Platform",
  description:
    "AI-assisted ECG decision support. Flags likely abnormal regions for doctor cross-checking.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
