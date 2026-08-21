import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "civic-compass — 今日の論点を、自分の視点で。",
  description: "ニュースへの関心から、自分と考えの近い政治家を見つけるプライベートな政治コンパス。",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ja"><body>{children}</body></html>;
}
