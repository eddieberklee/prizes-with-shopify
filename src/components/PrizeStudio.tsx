"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import {
  formatMinorMoney,
  type McpToolSummary,
  type McpWireTrace,
  type NormalizedCart,
  type NormalizedProduct,
  type NormalizedVariant,
} from "@/lib/shopify-mcp";

interface PrizePoolEntry {
  key: string;
  productId: string;
  sellerProductId: string | null;
  variantId: string;
  title: string;
  variantTitle: string;
  priceMinor: number;
  currency: string;
  formattedPrice: string;
  imageUrl: string | null;
  sellerName: string;
  sellerDomain: string | null;
  directCheckoutUrl: string | null;
  productUrl: string | null;
  quantity: number;
}

interface PrizeStudioProps {
  initialProducts: NormalizedProduct[];
  initialTools: McpToolSummary[];
  initialTraces: McpWireTrace[];
  initialQuery: string;
  defaultStoreDomain: string;
}

const QUICK_QUERIES = [
  "mechanical keyboard",
  "desk lamp",
  "espresso accessories",
  "wireless headphones",
  "edc pocket gear",
];

const BUDGET_TIERS: Array<{ label: string; maxMinor?: number }> = [
  { label: "Any budget" },
  { label: "Under $25", maxMinor: 2500 },
  { label: "Under $50", maxMinor: 5000 },
  { label: "Under $100", maxMinor: 10000 },
  { label: "Under $250", maxMinor: 25000 },
];

const PRESET_STORES = [
  { label: "Whalebone", domain: "3j6yup-ku.myshopify.com", defaultQuery: "stand" },
  { label: "Allbirds", domain: "allbirds.com", defaultQuery: "runner" },
];

const POOL_STORAGE_KEY = "prizes-with-shopify:pool:v1";

export function PrizeStudio({
  initialProducts,
  initialTools,
  initialTraces,
  initialQuery,
  defaultStoreDomain,
}: PrizeStudioProps) {
  const [mode, setMode] = useState<"global" | "storefront">("global");
  const [storeDomain, setStoreDomain] = useState(defaultStoreDomain);
  const [query, setQuery] = useState(initialQuery);
  const [maxPriceMinor, setMaxPriceMinor] = useState<number | undefined>(undefined);

  const [products, setProducts] = useState<NormalizedProduct[]>(initialProducts);
  const [selectedVariantByProduct, setSelectedVariantByProduct] = useState<Record<string, string>>(
    {}
  );
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [pool, setPool] = useState<PrizePoolEntry[]>([]);
  const [drawnWinnerKey, setDrawnWinnerKey] = useState<string | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  const [mintedCarts, setMintedCarts] = useState<Record<string, NormalizedCart>>({});
  const [mintingKey, setMintingKey] = useState<string | null>(null);
  const [cartError, setCartError] = useState<string | null>(null);

  const [askTarget, setAskTarget] = useState<{
    domain: string;
    sellerName: string;
    productTitle?: string;
    groundingIds: string[];
  } | null>(null);
  const [askInput, setAskInput] = useState("What is your shipping and return policy?");
  const [askAnswer, setAskAnswer] = useState<string | null>(null);
  const [isAsking, setIsAsking] = useState(false);

  const [tools, setTools] = useState<McpToolSummary[]>(initialTools);
  const [traces, setTraces] = useState<McpWireTrace[]>(initialTraces);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<"wire" | "tools">("wire");
  const [isLoadingTools, setIsLoadingTools] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(POOL_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as PrizePoolEntry[];
        if (Array.isArray(parsed)) setPool(parsed);
      }
    } catch {
      // Ignore corrupt localStorage entries
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(POOL_STORAGE_KEY, JSON.stringify(pool));
    } catch {
      // Ignore storage quota issues
    }
  }, [pool]);

  function pushTrace(trace: McpWireTrace | null | undefined) {
    if (!trace) return;
    setTraces((prev) => [trace, ...prev].slice(0, 30));
  }

  async function runSearch(overrides?: {
    nextMode?: "global" | "storefront";
    nextDomain?: string;
    nextQuery?: string;
    nextMaxPriceMinor?: number | undefined;
  }) {
    const activeMode = overrides?.nextMode ?? mode;
    const activeDomain = overrides?.nextDomain ?? storeDomain;
    const activeQuery = overrides?.nextQuery ?? query;
    const activeMax =
      overrides && "nextMaxPriceMinor" in overrides
        ? overrides.nextMaxPriceMinor
        : maxPriceMinor;

    setIsSearching(true);
    setSearchError(null);
    try {
      const res = await fetch("/api/mcp/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: activeMode,
          domain: activeMode === "storefront" ? activeDomain : undefined,
          query: activeQuery,
          limit: 12,
          maxPriceMinor: activeMax,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        products?: NormalizedProduct[];
        trace?: McpWireTrace;
        error?: string;
      };
      pushTrace(data.trace);
      if (!data.ok) {
        setSearchError(data.error || "MCP search failed.");
        return;
      }
      setProducts(data.products ?? []);
    } catch (err) {
      setSearchError((err as Error).message || "Network error calling /api/mcp/search.");
    } finally {
      setIsSearching(false);
    }
  }

  async function refreshToolsForTarget(nextMode: "global" | "storefront", nextDomain: string) {
    setIsLoadingTools(true);
    try {
      const res = await fetch("/api/mcp/tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "list",
          mode: nextMode,
          domain: nextMode === "storefront" ? nextDomain : undefined,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        tools?: McpToolSummary[];
        trace?: McpWireTrace;
      };
      pushTrace(data.trace);
      if (data.ok && data.tools) {
        setTools(data.tools);
      }
    } finally {
      setIsLoadingTools(false);
    }
  }

  function resolveActiveVariant(product: NormalizedProduct): NormalizedVariant | null {
    if (product.variants.length === 0) return null;
    const chosenId = selectedVariantByProduct[product.id];
    if (chosenId) {
      const found = product.variants.find((v) => v.id === chosenId);
      if (found) return found;
    }
    return product.variants.find((v) => v.available) ?? product.variants[0] ?? null;
  }

  function addToPool(product: NormalizedProduct) {
    const variant = resolveActiveVariant(product);
    if (!variant) return;
    const key = `${variant.sellerDomain || "shopify"}::${variant.id}`;
    setPool((prev) => {
      const existing = prev.find((item) => item.key === key);
      if (existing) {
        return prev.map((item) =>
          item.key === key ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      const entry: PrizePoolEntry = {
        key,
        productId: product.id,
        sellerProductId: product.sellerProductId,
        variantId: variant.id,
        title: product.title,
        variantTitle: variant.title === product.title ? "Standard" : variant.title,
        priceMinor: variant.priceMinor,
        currency: variant.currency,
        formattedPrice: variant.formattedPrice,
        imageUrl: variant.imageUrl || product.imageUrl,
        sellerName: variant.sellerName || product.seller.name,
        sellerDomain: variant.sellerDomain || product.seller.domain,
        directCheckoutUrl: variant.checkoutUrl,
        productUrl: variant.productUrl || product.productUrl,
        quantity: 1,
      };
      return [entry, ...prev];
    });
  }

  function updatePoolQuantity(key: string, delta: number) {
    setPool((prev) =>
      prev
        .map((item) =>
          item.key === key ? { ...item, quantity: item.quantity + delta } : item
        )
        .filter((item) => item.quantity > 0)
    );
    if (drawnWinnerKey === key && delta < 0) {
      const target = pool.find((i) => i.key === key);
      if (target && target.quantity + delta <= 0) setDrawnWinnerKey(null);
    }
  }

  async function mintCartForItems(
    domain: string,
    lineItems: Array<{ variantId: string; quantity: number }>,
    actionKey: string
  ) {
    setMintingKey(actionKey);
    setCartError(null);
    try {
      const res = await fetch("/api/mcp/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain,
          lineItems,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        cart?: NormalizedCart;
        trace?: McpWireTrace;
        error?: string;
      };
      pushTrace(data.trace);
      if (!data.ok || !data.cart) {
        setCartError(data.error || "Could not create cart via Storefront MCP.");
        return;
      }
      setMintedCarts((prev) => ({ ...prev, [domain]: data.cart! }));
    } catch (err) {
      setCartError((err as Error).message || "Network error calling /api/mcp/cart.");
    } finally {
      setMintingKey(null);
    }
  }

  function drawRandomPrize() {
    if (pool.length === 0 || isDrawing) return;
    setIsDrawing(true);
    let ticks = 0;
    const maxTicks = Math.min(12, Math.max(6, pool.length * 3));
    const interval = window.setInterval(() => {
      const pick = pool[Math.floor(Math.random() * pool.length)];
      if (pick) setDrawnWinnerKey(pick.key);
      ticks += 1;
      if (ticks >= maxTicks) {
        window.clearInterval(interval);
        const finalPick = pool[Math.floor(Math.random() * pool.length)];
        if (finalPick) setDrawnWinnerKey(finalPick.key);
        setIsDrawing(false);
      }
    }, 85);
  }

  async function submitAskBusiness() {
    if (!askTarget || !askInput.trim() || isAsking) return;
    setIsAsking(true);
    setAskAnswer(null);
    try {
      const res = await fetch("/api/mcp/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: askTarget.domain,
          query: askInput.trim(),
          ids: askTarget.groundingIds,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        answer?: string;
        trace?: McpWireTrace;
        error?: string;
      };
      pushTrace(data.trace);
      setAskAnswer(data.ok ? data.answer || "No response." : `Error: ${data.error}`);
    } catch (err) {
      setAskAnswer(`Error: ${(err as Error).message}`);
    } finally {
      setIsAsking(false);
    }
  }

  const latestTrace = traces[0] ?? null;

  const poolTotalByCurrency = useMemo(() => {
    const totals = new Map<string, number>();
    for (const item of pool) {
      totals.set(item.currency, (totals.get(item.currency) ?? 0) + item.priceMinor * item.quantity);
    }
    return Array.from(totals.entries()).map(([currency, amount]) =>
      formatMinorMoney(amount, currency)
    );
  }, [pool]);

  const poolGroupedByDomain = useMemo(() => {
    const groups = new Map<string, { sellerName: string; items: PrizePoolEntry[] }>();
    for (const item of pool) {
      const domainKey = item.sellerDomain || "unknown-domain";
      const existing = groups.get(domainKey);
      if (existing) {
        existing.items.push(item);
      } else {
        groups.set(domainKey, { sellerName: item.sellerName, items: [item] });
      }
    }
    return Array.from(groups.entries());
  }, [pool]);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top Status & Navigation Header */}
      <header className="sticky top-0 z-30 border-b border-zinc-800/80 bg-[#0b0d10]/90 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Icon name="gift" size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-semibold tracking-tight text-zinc-100">
                  Prizes with Shopify
                </h1>
                <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                  UCP MCP Live
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                {mode === "global"
                  ? "catalog.shopify.com/api/ucp/mcp · Cross-merchant discovery + storefront cart minting"
                  : `${storeDomain}/api/ucp/mcp · Single-storefront MCP mode`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {latestTrace && (
              <div className="hidden md:flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 py-1.5 text-xs text-zinc-300 tabular-nums">
                <span
                  className={`h-2 w-2 rounded-full ${
                    latestTrace.status === "ok" ? "bg-emerald-400" : "bg-amber-400"
                  }`}
                />
                <span className="font-mono text-zinc-200">
                  {latestTrace.toolName || latestTrace.method}
                </span>
                <span className="text-zinc-500">·</span>
                <span>{latestTrace.durationMs}ms</span>
                {latestTrace.apiVersion && (
                  <>
                    <span className="text-zinc-500">·</span>
                    <span className="text-zinc-400">UCP {latestTrace.apiVersion}</span>
                  </>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => setInspectorOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700/80 bg-zinc-900 hover:bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 transition cursor-pointer"
            >
              <Icon name="terminal" size={14} className="text-emerald-400" />
              <span>MCP Wire ({traces.length})</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left 8 Columns: Search, Controls, Product Results */}
        <section className="lg:col-span-8 space-y-5">
          {/* Source & Search Card */}
          <div className="rounded-2xl border border-zinc-800/90 bg-zinc-900/50 p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex rounded-xl bg-zinc-950 p-1 border border-zinc-800">
                <button
                  type="button"
                  onClick={() => {
                    setMode("global");
                    void runSearch({ nextMode: "global" });
                    void refreshToolsForTarget("global", storeDomain);
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
                    mode === "global"
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <Icon name="globe" size={14} />
                  Global Catalog MCP
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode("storefront");
                    const nextQuery = query === "mechanical keyboard" ? "stand" : query;
                    setQuery(nextQuery);
                    void runSearch({
                      nextMode: "storefront",
                      nextDomain: storeDomain,
                      nextQuery,
                    });
                    void refreshToolsForTarget("storefront", storeDomain);
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
                    mode === "storefront"
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <Icon name="store" size={14} />
                  Single Storefront MCP
                </button>
              </div>

              {mode === "storefront" && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {PRESET_STORES.map((preset) => (
                    <button
                      key={preset.domain}
                      type="button"
                      onClick={() => {
                        setStoreDomain(preset.domain);
                        setQuery(preset.defaultQuery);
                        void runSearch({
                          nextMode: "storefront",
                          nextDomain: preset.domain,
                          nextQuery: preset.defaultQuery,
                        });
                        void refreshToolsForTarget("storefront", preset.domain);
                      }}
                      className={`rounded-lg px-2.5 py-1 text-xs border transition cursor-pointer ${
                        storeDomain === preset.domain
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                          : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      setAskTarget({
                        domain: storeDomain,
                        sellerName: storeDomain,
                        groundingIds: [],
                      })
                    }
                    className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-950 hover:bg-zinc-800 px-2.5 py-1 text-xs text-zinc-200 transition cursor-pointer"
                  >
                    <Icon name="message-circle-question-mark" size={13} className="text-emerald-400" />
                    Ask Store
                  </button>
                </div>
              )}
            </div>

            {mode === "storefront" && (
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-zinc-500">
                    <Icon name="link" size={14} />
                  </span>
                  <input
                    type="text"
                    value={storeDomain}
                    onChange={(e) => setStoreDomain(e.target.value)}
                    placeholder="store.myshopify.com or custom Shopify domain"
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 pl-9 pr-3 py-2 text-xs font-mono text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/60 focus:outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void runSearch({ nextMode: "storefront", nextDomain: storeDomain });
                    void refreshToolsForTarget("storefront", storeDomain);
                  }}
                  className="rounded-xl border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 px-3 py-2 text-xs font-medium text-zinc-200 transition cursor-pointer"
                >
                  Connect Store
                </button>
              </div>
            )}

            {/* Search Input */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void runSearch();
              }}
              className="flex gap-2"
            >
              <div className="relative flex-1">
                <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-zinc-500">
                  <Icon name="search" size={16} />
                </span>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search prizes via Shopify MCP (e.g., mechanical keyboard, espresso grinder)..."
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 pl-10 pr-4 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500/60 focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={isSearching}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition cursor-pointer"
              >
                <Icon name="sparkles" size={15} />
                <span>{isSearching ? "Searching..." : "Search MCP"}</span>
              </button>
            </form>

            {/* Quick Queries + Prize Tier Filter */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex flex-wrap items-center gap-1.5">
                {mode === "global" &&
                  QUICK_QUERIES.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => {
                        setQuery(q);
                        void runSearch({ nextQuery: q });
                      }}
                      className={`rounded-full px-2.5 py-1 text-[11px] border transition cursor-pointer ${
                        query === q
                          ? "border-zinc-600 bg-zinc-800 text-zinc-100"
                          : "border-zinc-800/90 bg-zinc-950/60 text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      {q}
                    </button>
                  ))}
              </div>

              <div className="flex flex-wrap items-center gap-1">
                {BUDGET_TIERS.map((tier) => {
                  const active = maxPriceMinor === tier.maxMinor;
                  return (
                    <button
                      key={tier.label}
                      type="button"
                      onClick={() => {
                        setMaxPriceMinor(tier.maxMinor);
                        void runSearch({ nextMaxPriceMinor: tier.maxMinor });
                      }}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-medium border transition cursor-pointer ${
                        active
                          ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                          : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      {tier.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {searchError && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-200 flex items-start gap-2">
              <Icon name="info" size={16} className="text-red-400 shrink-0 mt-0.5" />
              <span>{searchError}</span>
            </div>
          )}

          {/* Results Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {products.map((product, idx) => {
              const activeVariant = resolveActiveVariant(product);
              const sellerDomain = activeVariant?.sellerDomain || product.seller.domain;
              const mintActionKey = `card::${activeVariant?.id || product.id}`;
              const mintedForDomain = sellerDomain ? mintedCarts[sellerDomain] : undefined;

              return (
                <article
                  key={product.id}
                  className="group rounded-2xl border border-zinc-800/90 bg-zinc-900/40 hover:border-zinc-700/90 transition flex flex-col overflow-hidden"
                >
                  <div className="relative aspect-[16/11] w-full bg-zinc-950 overflow-hidden">
                    {activeVariant?.imageUrl || product.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={activeVariant?.imageUrl || product.imageUrl || ""}
                        alt={product.title}
                        className="h-full w-full object-cover group-hover:scale-[1.02] transition duration-300"
                        loading={idx < 4 ? "eager" : "lazy"}
                      />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center text-zinc-700">
                        <Icon name="package" size={32} />
                      </div>
                    )}

                    <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between gap-2">
                      <span className="max-w-[70%] truncate rounded-full bg-zinc-950/85 backdrop-blur px-2.5 py-1 text-[11px] font-medium text-zinc-200 border border-zinc-800">
                        {product.seller.name}
                      </span>
                      {product.rating && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-zinc-950/85 backdrop-blur px-2 py-1 text-[11px] text-amber-300 border border-zinc-800 tabular-nums">
                          <Icon name="star" size={11} />
                          {product.rating.value} ({product.rating.count})
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex-1 p-4 flex flex-col justify-between gap-3">
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <h2 className="text-sm font-semibold text-zinc-100 line-clamp-2 leading-snug">
                          {product.title}
                        </h2>
                        <div className="text-right shrink-0 tabular-nums">
                          <div className="text-sm font-semibold text-emerald-400">
                            {activeVariant?.formattedPrice || product.formattedPrice}
                          </div>
                          {product.formattedListPrice && (
                            <div className="text-[11px] text-zinc-500 line-through">
                              {product.formattedListPrice}
                            </div>
                          )}
                        </div>
                      </div>

                      {product.description && (
                        <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed">
                          {product.description}
                        </p>
                      )}

                      {product.variants.length > 1 && (
                        <select
                          aria-label={`Select variant for ${product.title}`}
                          value={activeVariant?.id || ""}
                          onChange={(e) =>
                            setSelectedVariantByProduct((prev) => ({
                              ...prev,
                              [product.id]: e.target.value,
                            }))
                          }
                          className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 focus:border-emerald-500/60 focus:outline-none"
                        >
                          {product.variants.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.title} · {v.formattedPrice}
                              {!v.available ? " (Sold out)" : ""}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>

                    <div className="pt-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => addToPool(product)}
                          disabled={!activeVariant}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/35 px-3 py-2 text-xs font-semibold text-emerald-300 transition cursor-pointer"
                        >
                          <Icon name="plus" size={14} />
                          Add to Prize Pool
                        </button>

                        {sellerDomain && activeVariant && (
                          <button
                            type="button"
                            disabled={mintingKey === mintActionKey}
                            onClick={() =>
                              void mintCartForItems(
                                sellerDomain,
                                [{ variantId: activeVariant.id, quantity: 1 }],
                                mintActionKey
                              )
                            }
                            title={`Call create_cart on ${sellerDomain}/api/ucp/mcp`}
                            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-200 transition cursor-pointer"
                          >
                            <Icon name="shopping-bag" size={14} />
                            <span>
                              {mintingKey === mintActionKey ? "Minting..." : "MCP Cart"}
                            </span>
                          </button>
                        )}

                        {sellerDomain && (
                          <button
                            type="button"
                            onClick={() => {
                              const gids = [
                                product.sellerProductId,
                                activeVariant?.id,
                              ].filter((x): x is string => Boolean(x));
                              setAskTarget({
                                domain: sellerDomain,
                                sellerName: product.seller.name,
                                productTitle: product.title,
                                groundingIds: gids,
                              });
                              setAskAnswer(null);
                            }}
                            title={`Ask ${sellerDomain} via ask_business MCP tool`}
                            className="inline-flex items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950 hover:bg-zinc-800 p-2 text-zinc-300 transition cursor-pointer"
                          >
                            <Icon name="message-circle-question-mark" size={14} />
                          </button>
                        )}
                      </div>

                      {mintedForDomain?.continueUrl && (
                        <a
                          href={mintedForDomain.continueUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-1.5 text-[11px] text-emerald-300 hover:bg-emerald-500/20 transition"
                        >
                          <span>
                            Live cart ready ({mintedForDomain.formattedTotal})
                          </span>
                          <span className="inline-flex items-center gap-1 font-semibold">
                            Checkout <Icon name="external-link" size={11} />
                          </span>
                        </a>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          {!isSearching && products.length === 0 && (
            <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/30 p-10 text-center space-y-2">
              <p className="text-sm font-medium text-zinc-300">
                No products matched this query and budget filter.
              </p>
              <p className="text-xs text-zinc-500">
                Try clearing the budget filter or searching a broader keyword.
              </p>
            </div>
          )}
        </section>

        {/* Right 4 Columns: Prize Pool, Random Draw, and Minted MCP Carts */}
        <aside className="lg:col-span-4 space-y-5">
          <div className="rounded-2xl border border-zinc-800/90 bg-zinc-900/50 p-4 sm:p-5 space-y-4 sticky top-20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Icon name="trophy" size={17} className="text-amber-400" />
                <h2 className="text-sm font-semibold text-zinc-100">
                  Prize Pool ({pool.reduce((sum, i) => sum + i.quantity, 0)})
                </h2>
              </div>
              {pool.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setPool([]);
                    setDrawnWinnerKey(null);
                  }}
                  className="text-[11px] text-zinc-500 hover:text-zinc-300 transition cursor-pointer"
                >
                  Clear pool
                </button>
              )}
            </div>

            {pool.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-800 p-6 text-center space-y-2">
                <Icon name="sparkles" size={20} className="mx-auto text-zinc-600" />
                <p className="text-xs text-zinc-400">
                  Add products from Shopify MCP search results to curate your prize pool, draw a
                  winner, and mint live Shopify checkout carts.
                </p>
              </div>
            ) : (
              <>
                {/* Draw Winner Action */}
                <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3.5 py-2.5">
                  <div className="text-xs">
                    <div className="font-medium text-amber-200">Prize Draw</div>
                    <div className="text-[11px] text-amber-300/80 tabular-nums">
                      Pool value: {poolTotalByCurrency.join(" + ")}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={isDrawing || pool.length === 0}
                    onClick={drawRandomPrize}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 disabled:opacity-50 px-3 py-1.5 text-xs font-semibold text-zinc-950 transition cursor-pointer"
                  >
                    <Icon name="dices" size={14} />
                    <span>{isDrawing ? "Drawing..." : "Draw Prize"}</span>
                  </button>
                </div>

                {/* Grouped by Merchant so Storefront create_cart bundles cleanly */}
                <div className="space-y-3 max-h-[52vh] overflow-y-auto pr-1">
                  {poolGroupedByDomain.map(([domain, group]) => {
                    const hasRealDomain = domain !== "unknown-domain";
                    const groupMintKey = `pool::${domain}`;
                    const minted = hasRealDomain ? mintedCarts[domain] : undefined;

                    return (
                      <div
                        key={domain}
                        className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3 space-y-2.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="truncate">
                            <div className="text-xs font-semibold text-zinc-200 truncate">
                              {group.sellerName}
                            </div>
                            {hasRealDomain && (
                              <div className="text-[10px] font-mono text-zinc-500 truncate">
                                {domain}
                              </div>
                            )}
                          </div>

                          {hasRealDomain && (
                            <button
                              type="button"
                              disabled={mintingKey === groupMintKey}
                              onClick={() =>
                                void mintCartForItems(
                                  domain,
                                  group.items.map((item) => ({
                                    variantId: item.variantId,
                                    quantity: item.quantity,
                                  })),
                                  groupMintKey
                                )
                              }
                              className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/35 px-2.5 py-1 text-[11px] font-medium text-emerald-300 transition cursor-pointer"
                            >
                              <Icon name="shopping-cart" size={12} />
                              <span>
                                {mintingKey === groupMintKey ? "Minting..." : "Mint Store Cart"}
                              </span>
                            </button>
                          )}
                        </div>

                        <div className="space-y-2">
                          {group.items.map((item) => {
                            const isWinner = drawnWinnerKey === item.key;
                            return (
                              <div
                                key={item.key}
                                className={`flex items-center gap-2.5 rounded-lg p-2 border transition ${
                                  isWinner
                                    ? "border-amber-400 bg-amber-400/10"
                                    : "border-zinc-800/80 bg-zinc-900/50"
                                }`}
                              >
                                {item.imageUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={item.imageUrl}
                                    alt={item.title}
                                    className="h-10 w-10 rounded-md object-cover bg-zinc-950 shrink-0"
                                  />
                                ) : (
                                  <div className="h-10 w-10 rounded-md bg-zinc-950 shrink-0 flex items-center justify-center text-zinc-700">
                                    <Icon name="gift" size={14} />
                                  </div>
                                )}

                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5">
                                    {isWinner && (
                                      <span className="rounded bg-amber-400 px-1.5 py-0.5 text-[9px] font-bold uppercase text-zinc-950">
                                        Winner
                                      </span>
                                    )}
                                    <p className="text-xs font-medium text-zinc-200 truncate">
                                      {item.title}
                                    </p>
                                  </div>
                                  <p className="text-[11px] text-zinc-500 truncate tabular-nums">
                                    {item.variantTitle} · {item.formattedPrice}
                                  </p>
                                </div>

                                <div className="flex items-center gap-1 shrink-0 tabular-nums">
                                  <button
                                    type="button"
                                    onClick={() => updatePoolQuantity(item.key, -1)}
                                    className="h-6 w-6 rounded border border-zinc-800 bg-zinc-950 hover:bg-zinc-800 text-xs text-zinc-300 cursor-pointer"
                                  >
                                    -
                                  </button>
                                  <span className="w-5 text-center text-xs text-zinc-200">
                                    {item.quantity}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => updatePoolQuantity(item.key, 1)}
                                    className="h-6 w-6 rounded border border-zinc-800 bg-zinc-950 hover:bg-zinc-800 text-xs text-zinc-300 cursor-pointer"
                                  >
                                    +
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {minted?.continueUrl && (
                          <a
                            href={minted.continueUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-between rounded-lg bg-emerald-500/15 border border-emerald-500/40 px-3 py-2 text-xs text-emerald-200 hover:bg-emerald-500/25 transition"
                          >
                            <span className="tabular-nums">
                              Checkout ready · {minted.formattedTotal}
                            </span>
                            <span className="inline-flex items-center gap-1 font-semibold">
                              Open Checkout <Icon name="arrow-up-right" size={13} />
                            </span>
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {cartError && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-200">
                {cartError}
              </div>
            )}
          </div>
        </aside>
      </main>

      {/* Ask Merchant MCP Modal */}
      {askTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950 p-5 space-y-4 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-mono text-emerald-300">
                    ask_business
                  </span>
                  <h3 className="text-sm font-semibold text-zinc-100">
                    Ask {askTarget.sellerName}
                  </h3>
                </div>
                <p className="text-xs text-zinc-500 font-mono mt-0.5">
                  https://{askTarget.domain}/api/ucp/mcp
                </p>
                {askTarget.productTitle && (
                  <p className="text-xs text-zinc-400 mt-1">
                    Grounded on: <span className="text-zinc-200">{askTarget.productTitle}</span>
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setAskTarget(null)}
                className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 cursor-pointer"
              >
                <Icon name="x" size={16} />
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {[
                "What is your return policy?",
                "How fast does shipping take to the US?",
                "Tell me key specs and materials for this product.",
              ].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setAskInput(preset)}
                  className="rounded-full border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 px-2.5 py-1 text-[11px] text-zinc-300 cursor-pointer"
                >
                  {preset}
                </button>
              ))}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submitAskBusiness();
              }}
              className="flex gap-2"
            >
              <input
                type="text"
                value={askInput}
                onChange={(e) => setAskInput(e.target.value)}
                className="flex-1 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500/60 focus:outline-none"
              />
              <button
                type="submit"
                disabled={isAsking}
                className="rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 px-4 py-2 text-xs font-semibold text-zinc-950 cursor-pointer"
              >
                {isAsking ? "Asking..." : "Send"}
              </button>
            </form>

            {askAnswer && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3.5 text-xs text-zinc-200 leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto">
                {askAnswer}
              </div>
            )}
          </div>
        </div>
      )}

      {/* MCP Wire Inspector & Tool Discovery Drawer */}
      {inspectorOpen && (
        <div className="fixed inset-y-0 right-0 z-40 w-full max-w-xl border-l border-zinc-800 bg-[#0d1015] shadow-2xl flex flex-col">
          <div className="px-4 py-3.5 border-b border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Icon name="terminal" size={16} className="text-emerald-400" />
              <h3 className="text-sm font-semibold text-zinc-100">Shopify MCP Inspector</h3>
            </div>
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-lg bg-zinc-950 p-0.5 border border-zinc-800 text-xs">
                <button
                  type="button"
                  onClick={() => setInspectorTab("wire")}
                  className={`px-2.5 py-1 rounded-md cursor-pointer ${
                    inspectorTab === "wire"
                      ? "bg-zinc-800 text-zinc-100"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  JSON-RPC Wire ({traces.length})
                </button>
                <button
                  type="button"
                  onClick={() => setInspectorTab("tools")}
                  className={`px-2.5 py-1 rounded-md cursor-pointer ${
                    inspectorTab === "tools"
                      ? "bg-zinc-800 text-zinc-100"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  tools/list ({tools.length})
                </button>
              </div>
              <button
                type="button"
                onClick={() => setInspectorOpen(false)}
                className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 cursor-pointer"
              >
                <Icon name="x" size={16} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {inspectorTab === "wire" ? (
              traces.map((trace) => (
                <div
                  key={trace.id}
                  className="rounded-xl border border-zinc-800 bg-zinc-950 p-3 space-y-2 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 font-mono">
                      <span
                        className={`h-2 w-2 rounded-full ${
                          trace.status === "ok" ? "bg-emerald-400" : "bg-red-400"
                        }`}
                      />
                      <span className="font-semibold text-zinc-100">
                        {trace.toolName || trace.method}
                      </span>
                      <span className="text-zinc-500">·</span>
                      <span className="text-emerald-400">{trace.durationMs}ms</span>
                    </div>
                    <span className="text-[11px] font-mono text-zinc-500">
                      {trace.authMode}
                      {trace.apiVersion ? ` · ${trace.apiVersion}` : ""}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-zinc-400 truncate">
                    POST {trace.endpoint}
                  </div>
                  <details className="group">
                    <summary className="cursor-pointer text-[11px] text-zinc-400 hover:text-zinc-200 select-none">
                      Inspect JSON-RPC payload & response
                    </summary>
                    <div className="mt-2 space-y-2">
                      <pre className="rounded-lg bg-zinc-900 p-2.5 text-[11px] font-mono text-zinc-300 overflow-x-auto">
                        {JSON.stringify(trace.requestBody, null, 2)}
                      </pre>
                      <pre className="rounded-lg bg-zinc-900 p-2.5 text-[11px] font-mono text-emerald-300/90 overflow-x-auto">
                        {JSON.stringify(trace.responsePreview, null, 2)}
                      </pre>
                    </div>
                  </details>
                </div>
              ))
            ) : (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <span>
                    Active server:{" "}
                    <code className="text-zinc-200">
                      {mode === "global"
                        ? "catalog.shopify.com/api/ucp/mcp"
                        : `${storeDomain}/api/ucp/mcp`}
                    </code>
                  </span>
                  <button
                    type="button"
                    disabled={isLoadingTools}
                    onClick={() => void refreshToolsForTarget(mode, storeDomain)}
                    className="text-emerald-400 hover:text-emerald-300 cursor-pointer"
                  >
                    {isLoadingTools ? "Refreshing..." : "Refresh"}
                  </button>
                </div>
                {tools.map((tool) => (
                  <div
                    key={tool.name}
                    className="rounded-xl border border-zinc-800 bg-zinc-950 p-3 space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono font-semibold text-emerald-300">
                        {tool.name}
                      </span>
                      <span className="text-[10px] font-mono text-zinc-500">
                        params: {tool.topLevelProperties.join(", ")}
                      </span>
                    </div>
                    {tool.description && (
                      <p className="text-xs text-zinc-400">{tool.description}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
