import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GNG 财务系统",
  description: "海柜初始账单、单柜盈亏和支出标准"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
