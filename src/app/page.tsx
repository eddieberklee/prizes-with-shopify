import { PrizeStudio } from "@/components/PrizeStudio";
import {
  discoverMcpTools,
  type McpToolSummary,
  type McpWireTrace,
  type NormalizedProduct,
  searchShopifyCatalog,
} from "@/lib/shopify-mcp";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const initialQuery = "mechanical keyboard";
  const defaultStoreDomain =
    process.env.NEXT_PUBLIC_DEFAULT_STORE_DOMAIN || "3j6yup-ku.myshopify.com";

  let initialProducts: NormalizedProduct[] = [];
  let initialTools: McpToolSummary[] = [];
  const initialTraces: McpWireTrace[] = [];

  const [searchOutcome, toolsOutcome] = await Promise.allSettled([
    searchShopifyCatalog({
      target: { mode: "global" },
      query: initialQuery,
      limit: 12,
    }),
    discoverMcpTools({ mode: "global" }),
  ]);

  if (searchOutcome.status === "fulfilled") {
    initialProducts = searchOutcome.value.products;
    initialTraces.push(searchOutcome.value.trace);
  }
  if (toolsOutcome.status === "fulfilled") {
    initialTools = toolsOutcome.value.tools;
    initialTraces.push(toolsOutcome.value.trace);
  }

  return (
    <PrizeStudio
      initialProducts={initialProducts}
      initialTools={initialTools}
      initialTraces={initialTraces}
      initialQuery={initialQuery}
      defaultStoreDomain={defaultStoreDomain}
    />
  );
}
