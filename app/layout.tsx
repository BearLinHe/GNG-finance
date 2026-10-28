import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GNG价格核算",
  description: "OAK、SAV 单柜核算与 OAK 运输部核算"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
