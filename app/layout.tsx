import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Complyance Hiring", template: "%s · Complyance Hiring" },
  description: "Hiring operations, structured interviews, and accountable decisions."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
