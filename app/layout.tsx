import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QueueLens — Job Queue Console",
  description:
    "In-memory job queue with retries, backoff, and payload redaction. Portfolio demo by Saeed Rumaneh.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
