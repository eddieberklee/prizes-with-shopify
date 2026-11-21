import { NextResponse } from "next/server";
import {
  callShopifyMcpRpc,
  discoverMcpTools,
  type McpTarget,
  type McpWireTrace,
} from "@/lib/shopify-mcp";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: "list" | "call";
      mode?: "global" | "storefront";
      domain?: string;
      surface?: "ucp" | "legacy";
      toolName?: string;
      toolArgs?: Record<string, unknown>;
    };

    const target: McpTarget =
      body.mode === "storefront"
        ? {
            mode: "storefront",
            domain: body.domain || "",
            surface: body.surface ?? "ucp",
          }
        : { mode: "global" };

    if (body.action === "call") {
      if (!body.toolName?.trim()) {
        return NextResponse.json(
          { ok: false, error: "toolName is required when action is 'call'." },
          { status: 400 }
        );
      }
      const { payload, trace } = await callShopifyMcpRpc({
        target,
        method: "tools/call",
        params: {
          name: body.toolName.trim(),
          arguments: body.toolArgs ?? {},
        },
      });
      return NextResponse.json({ ok: true, payload, trace });
    }

    const result = await discoverMcpTools(target);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const error = err as Error & { trace?: McpWireTrace };
    return NextResponse.json(
      {
        ok: false,
        error: error.message || "MCP tool introspection failed.",
        trace: error.trace ?? null,
      },
      { status: 400 }
    );
  }
}
