import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Ruang Konten — Studio publikasi pribadi",
  description:
    "Siapkan, review, dan publikasikan konten dari satu ruang kerja lokal.",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
