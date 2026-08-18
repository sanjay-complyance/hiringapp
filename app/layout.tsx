import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Senior Hiring Review",
  description: "Resume ranking and hiring-process workspace for Senior Software Developer candidates."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
