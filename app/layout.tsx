import type { Metadata } from "next";
import "./globals.css";
import { AssistantAvailability } from "./finance-page-context";
import { assistantMode } from "@/lib/finance-assistant-access";

export const metadata: Metadata = {
  title: "GNG价格核算",
  description: "OAK、SAV 单柜核算与 OAK 运输部核算"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body><AssistantAvailability enabled={assistantMode(process.env)!=='off'}>{children}</AssistantAvailability></body>
    </html>
  );
}
