import type { Metadata } from "next";
import "./globals.css";
import Shell from "@/components/Shell";

export const metadata: Metadata = {
  title: "Lab RAG",
  description: "회의를 녹음·전사하고, 지난 회의에게 물어보세요.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
