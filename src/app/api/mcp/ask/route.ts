import { NextResponse } from "next/server";
import { askStoreMcp, type McpWireTrace } from "@/lib/shopify-mcp";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      domain?: string;
      query?: string;
      ids?: string[];
    };

    if (!body.domain) {
      return NextResponse.json(
        { ok: false, error: "Store domain is required for ask_business." },
        { status: 400 }
      );
    }
    if (!body.query?.trim()) {
      return NextResponse.json(
        { ok: false, error: "Question is required." },
        { status: 400 }
      );
    }

    const result = await askStoreMcp({
      domain: body.domain,
      query: body.query,
      ids: body.ids,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const error = err as Error & { trace?: McpWireTrace };
    return NextResponse.json(
      {
        ok: false,
        error: error.message || "Storefront ask_business failed.",
        trace: error.trace ?? null,
      },
      { status: 400 }
    );
  }
}
