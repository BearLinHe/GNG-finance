import { NextResponse } from "next/server";
import { resolveDriverLocations } from "@/lib/oak-driver-locations";

export async function POST(request: Request) {
  try {
    const text = await request.text();
    if (text.length > 40000) return NextResponse.json({ error: "地点查询数量过多" }, { status: 413 });
    const body = JSON.parse(text);
    if (!Array.isArray(body.codes) || body.codes.length > 300 || body.codes.some((code: unknown) => typeof code !== "string" || !code.trim() || code.length > 120)) {
      return NextResponse.json({ error: "地点格式无效" }, { status: 400 });
    }
    return NextResponse.json({ locations: resolveDriverLocations(body.codes) });
  } catch {
    return NextResponse.json({ error: "读取地点失败" }, { status: 400 });
  }
}
