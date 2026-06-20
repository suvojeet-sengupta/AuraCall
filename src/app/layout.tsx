import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AuraCall - Google Meet Style Calling",
  description: "A professional, ultra-performance WebRTC multi-party video calling web application optimized for low bandwidth.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
