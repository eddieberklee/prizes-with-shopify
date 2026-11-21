import { NextResponse } from "next/server";
import {
  createOrUpdateStoreCart,
  type McpWireTrace,
} from "@/lib/shopify-mcp";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      domain?: string;
      cartId?: string;
      lineItems?: Array<{ variantId: string; quantity: number; lineId?: string }>;
    };

    if (!body.domain) {
      return NextResponse.json(
        { ok: false, error: "Store domain is required to create or update a cart." },
        { status: 400 }
      );
    }

    if (!Array.isArray(body.lineItems) || body.lineItems.length === 0) {
      return NextResponse.json(
        { ok: false, error: "At least one line item is required." },
        { status: 400 }
      );
    }

    const result = await createOrUpdateStoreCart({
      domain: body.domain,
      cartId: body.cartId,
      lineItems: body.lineItems,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const error = err as Error & { trace?: McpWireTrace };
    return NextResponse.json(
      {
        ok: false,
        error: error.message || "Storefront cart call failed.",
        trace: error.trace ?? null,
      },
      { status: 400 }
    );
  }
}
