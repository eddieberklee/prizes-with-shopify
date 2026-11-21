import { NextResponse } from "next/server";
import {
  type McpTarget,
  type McpWireTrace,
  searchShopifyCatalog,
} from "@/lib/shopify-mcp";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      mode?: "global" | "storefront";
      domain?: string;
      query?: string;
      limit?: number;
      cursor?: string;
      minPriceMinor?: number;
      maxPriceMinor?: number;
      currency?: string;
      country?: string;
      intent?: string;
    };

    const target: McpTarget =
      body.mode === "storefront"
        ? { mode: "storefront", domain: body.domain || "" }
        : { mode: "global" };

    const result = await searchShopifyCatalog({
      target,
      query: body.query || "desk",
      limit: body.limit ?? 12,
      cursor: body.cursor,
      minPriceMinor: body.minPriceMinor,
      maxPriceMinor: body.maxPriceMinor,
      currency: body.currency,
      country: body.country,
      intent: body.intent,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const error = err as Error & { trace?: McpWireTrace };
    return NextResponse.json(
      {
        ok: false,
        error: error.message || "Catalog search failed.",
        trace: error.trace ?? null,
      },
      { status: 400 }
    );
  }
}
