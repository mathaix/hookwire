import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hookwire",
  description: "Approval control plane for AI coding agents"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
