export const GLOBAL_CATALOG_MCP_URL = "https://catalog.shopify.com/api/ucp/mcp";
export const SHOPIFY_AUTH_TOKEN_URL = "https://api.shopify.com/auth/access_token";
export const DEFAULT_UCP_AGENT_PROFILE =
  process.env.SHOPIFY_UCP_AGENT_PROFILE ||
  "https://shopify.dev/ucp/agent-profiles/draft/valid-with-capabilities.json";

export type McpTarget =
  | { mode: "global" }
  | { mode: "storefront"; domain: string; surface?: "ucp" | "legacy" };

export type AuthMode = "client_credentials" | "unauthenticated";

export interface McpWireTrace {
  id: string;
  endpoint: string;
  method: string;
  toolName?: string;
  durationMs: number;
  apiVersion: string | null;
  requestId: string | null;
  authMode: AuthMode;
  status: "ok" | "error";
  requestBody: unknown;
  responsePreview: unknown;
  timestamp: string;
}

export interface NormalizedVariant {
  id: string;
  title: string;
  available: boolean;
  priceMinor: number;
  currency: string;
  formattedPrice: string;
  checkoutUrl: string | null;
  productUrl: string | null;
  sellerDomain: string | null;
  sellerName: string | null;
  imageUrl: string | null;
  options: Array<{ name: string; label: string }>;
}

export interface NormalizedProduct {
  id: string;
  sellerProductId: string | null;
  title: string;
  handle: string;
  description: string;
  imageUrl: string | null;
  priceMinor: number;
  maxPriceMinor: number;
  currency: string;
  formattedPrice: string;
  listPriceMinor: number | null;
  formattedListPrice: string | null;
  rating: { value: number; count: number } | null;
  highlights: string[];
  seller: {
    name: string;
    domain: string | null;
    url: string | null;
  };
  productUrl: string | null;
  variants: NormalizedVariant[];
}

export interface NormalizedCartLine {
  id: string;
  variantId: string;
  title: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  formattedUnitPrice: string;
  formattedLineTotal: string;
  imageUrl: string | null;
}

export interface NormalizedCart {
  id: string;
  domain: string;
  currency: string;
  subtotalMinor: number;
  totalMinor: number;
  formattedSubtotal: string;
  formattedTotal: string;
  continueUrl: string | null;
  expiresAt: string | null;
  lineItems: NormalizedCartLine[];
}

export interface McpToolSummary {
  name: string;
  description: string;
  requiredParams: string[];
  topLevelProperties: string[];
  inputSchema: Record<string, unknown>;
}

let cachedToken: { accessToken: string; expiresAtMs: number } | null = null;

const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "JPY",
  "KMF",
  "KRW",
  "MGA",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);

const THREE_DECIMAL_CURRENCIES = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);

export function formatMinorMoney(amountMinor: number, currency = "USD"): string {
  const code = (currency || "USD").toUpperCase();
  const decimals = ZERO_DECIMAL_CURRENCIES.has(code)
    ? 0
    : THREE_DECIMAL_CURRENCIES.has(code)
      ? 3
      : 2;
  const major = amountMinor / 10 ** decimals;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(major);
  } catch {
    return `${code} ${major.toFixed(decimals)}`;
  }
}

export function stripHtmlToText(input: string | undefined | null): string {
  if (!input) return "";
  return input
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeStoreDomain(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) {
    throw new Error("Store domain is required.");
  }
  const withoutScheme = trimmed.replace(/^https?:\/\//, "").split("/")[0]?.split("?")[0] ?? "";
  if (!withoutScheme || withoutScheme.includes(":")) {
    throw new Error(`Invalid store domain "${raw}". Provide a public hostname without port.`);
  }
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(withoutScheme)) {
    throw new Error(`Invalid store hostname "${withoutScheme}".`);
  }
  if (
    withoutScheme === "localhost" ||
    withoutScheme.endsWith(".local") ||
    withoutScheme.endsWith(".internal") ||
    /^\d+\.\d+\.\d+\.\d+$/.test(withoutScheme)
  ) {
    throw new Error(`Disallowed store hostname "${withoutScheme}".`);
  }
  return withoutScheme;
}

export function resolveMcpEndpoint(target: McpTarget): string {
  if (target.mode === "global") {
    return GLOBAL_CATALOG_MCP_URL;
  }
  const domain = normalizeStoreDomain(target.domain);
  const path = target.surface === "legacy" ? "/api/mcp" : "/api/ucp/mcp";
  return `https://${domain}${path}`;
}

async function getShopifyAuthHeader(): Promise<{ token: string | null; authMode: AuthMode }> {
  const clientId = process.env.SHOPIFY_CLIENT_ID?.trim();
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return { token: null, authMode: "unauthenticated" };
  }

  const now = Date.now();
  if (cachedToken && cachedToken.expiresAtMs - 60_000 > now) {
    return { token: cachedToken.accessToken, authMode: "client_credentials" };
  }

  const res = await fetch(SHOPIFY_AUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Shopify token exchange failed with HTTP ${res.status}.`);
  }

  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) {
    throw new Error("Shopify token exchange succeeded without returning access_token.");
  }

  const ttlSeconds = typeof json.expires_in === "number" ? json.expires_in : 3600;
  cachedToken = {
    accessToken: json.access_token,
    expiresAtMs: now + ttlSeconds * 1000,
  };
  return { token: cachedToken.accessToken, authMode: "client_credentials" };
}

function buildUcpMeta() {
  return {
    "ucp-agent": {
      profile: DEFAULT_UCP_AGENT_PROFILE,
    },
  };
}

function extractStructuredPayload(rpcResult: Record<string, unknown>): Record<string, unknown> {
  if (rpcResult.structuredContent && typeof rpcResult.structuredContent === "object") {
    return rpcResult.structuredContent as Record<string, unknown>;
  }
  const content = rpcResult.content;
  if (Array.isArray(content) && content.length > 0) {
    const first = content[0] as { type?: string; text?: string };
    if (first?.type === "text" && typeof first.text === "string") {
      try {
        const parsed = JSON.parse(first.text);
        if (parsed && typeof parsed === "object") {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return { text: first.text };
      }
    }
  }
  return rpcResult;
}

function summarizeResponseForTrace(payload: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  if (payload.ucp && typeof payload.ucp === "object") {
    const ucp = payload.ucp as Record<string, unknown>;
    summary.ucp = {
      version: ucp.version,
      status: ucp.status,
      capabilities: ucp.capabilities ? Object.keys(ucp.capabilities as object) : undefined,
    };
  }
  if (Array.isArray(payload.tools)) {
    summary.toolCount = payload.tools.length;
    summary.toolNames = payload.tools.map((t) => (t as { name?: string }).name);
  }
  if (Array.isArray(payload.products)) {
    summary.productCount = payload.products.length;
    summary.sampleProducts = payload.products.slice(0, 3).map((p) => {
      const prod = p as Record<string, unknown>;
      return { id: prod.id, title: prod.title, price_range: prod.price_range };
    });
  }
  if (payload.pagination) {
    summary.pagination = payload.pagination;
  }
  if (payload.id && Array.isArray(payload.line_items)) {
    summary.cartId = payload.id;
    summary.lineItemCount = payload.line_items.length;
    summary.totals = payload.totals;
    summary.continue_url = payload.continue_url;
  }
  if (payload.answer) {
    summary.answer = payload.answer;
  }
  if (Array.isArray(payload.messages) && payload.messages.length > 0) {
    summary.messages = payload.messages;
  }
  return Object.keys(summary).length > 0 ? summary : payload;
}

export async function callShopifyMcpRpc(options: {
  target: McpTarget;
  method: "tools/list" | "tools/call";
  params: Record<string, unknown>;
}): Promise<{ payload: Record<string, unknown>; trace: McpWireTrace }> {
  const endpoint = resolveMcpEndpoint(options.target);
  const { token, authMode } = await getShopifyAuthHeader();
  const rpcId = `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const requestBody = {
    jsonrpc: "2.0",
    id: rpcId,
    method: options.method,
    params: options.params,
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const started = performance.now();
  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
    cache: "no-store",
  });
  const durationMs = Math.round(performance.now() - started);
  const apiVersion = res.headers.get("x-shopify-ucp-mcp-api-version");
  const requestId = res.headers.get("x-request-id");

  const rawText = await res.text();
  let rpcEnvelope: Record<string, unknown>;
  try {
    rpcEnvelope = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    throw new Error(
      `Non-JSON response from ${endpoint} (HTTP ${res.status}). Confirm this domain is a Shopify storefront with MCP enabled.`
    );
  }

  const toolName =
    options.method === "tools/call" && typeof options.params.name === "string"
      ? options.params.name
      : undefined;

  if (!res.ok || rpcEnvelope.error) {
    const errObj = rpcEnvelope.error as { message?: string; code?: number } | undefined;
    const msg = errObj?.message || `MCP HTTP ${res.status}`;
    throw new Error(`Shopify MCP error (${endpoint}): ${msg}`);
  }

  const resultObj = (rpcEnvelope.result ?? {}) as Record<string, unknown>;
  const payload = extractStructuredPayload(resultObj);
  const ucpStatus = (payload.ucp as { status?: string } | undefined)?.status;
  const messages = Array.isArray(payload.messages)
    ? (payload.messages as Array<{ content?: string; type?: string }>)
    : [];

  const isError = Boolean(resultObj.isError) || ucpStatus === "error";
  const trace: McpWireTrace = {
    id: rpcId,
    endpoint,
    method: options.method,
    toolName,
    durationMs,
    apiVersion,
    requestId,
    authMode,
    status: isError ? "error" : "ok",
    requestBody,
    responsePreview: summarizeResponseForTrace(payload),
    timestamp: new Date().toISOString(),
  };

  if (isError) {
    const detail =
      messages.map((m) => m.content).filter(Boolean).join("; ") ||
      "Shopify MCP reported tool error.";
    const err = new Error(detail) as Error & { trace?: McpWireTrace };
    err.trace = trace;
    throw err;
  }

  return { payload, trace };
}

function optimizeShopifyImageUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    if (u.hostname === "cdn.shopify.com" && !u.searchParams.has("width")) {
      u.searchParams.set("width", "640");
      return u.toString();
    }
  } catch {
    // Keep original URL when parsing fails
  }
  return rawUrl;
}

function readImageUrl(mediaList: unknown): string | null {
  if (!Array.isArray(mediaList)) return null;
  for (const item of mediaList) {
    if (!item || typeof item !== "object") continue;
    const m = item as {
      type?: string;
      url?: string;
      preview?: { url?: string };
    };
    if (m.type === "image" && typeof m.url === "string") return optimizeShopifyImageUrl(m.url);
    if (m.preview && typeof m.preview.url === "string")
      return optimizeShopifyImageUrl(m.preview.url);
  }
  return null;
}

export function normalizeUcpProduct(
  raw: Record<string, unknown>,
  fallbackDomain?: string
): NormalizedProduct {
  const priceRange = raw.price_range as
    | {
        min?: { amount?: number; currency?: string };
        max?: { amount?: number; currency?: string };
      }
    | undefined;
  const listPriceRange = raw.list_price_range as
    | {
        min?: { amount?: number; currency?: string };
      }
    | undefined;

  const currency = priceRange?.min?.currency || "USD";
  const priceMinor = typeof priceRange?.min?.amount === "number" ? priceRange.min.amount : 0;
  const maxPriceMinor =
    typeof priceRange?.max?.amount === "number" ? priceRange.max.amount : priceMinor;
  const listPriceMinor =
    typeof listPriceRange?.min?.amount === "number" && listPriceRange.min.amount > priceMinor
      ? listPriceRange.min.amount
      : null;

  const rawDesc = raw.description as { plain?: string; html?: string } | string | undefined;
  const descString =
    typeof rawDesc === "string"
      ? rawDesc
      : rawDesc?.plain || rawDesc?.html || "";

  const metadata = raw.metadata as
    | { unique_selling_points?: string[]; top_features?: string[] }
    | undefined;
  const highlights = [
    ...(Array.isArray(metadata?.unique_selling_points) ? metadata.unique_selling_points : []),
    ...(Array.isArray(metadata?.top_features) ? metadata.top_features : []),
  ].slice(0, 3);

  const rawVariants = Array.isArray(raw.variants)
    ? (raw.variants as Array<Record<string, unknown>>)
    : [];

  const variants: NormalizedVariant[] = rawVariants.map((v) => {
    const vPrice = v.price as { amount?: number; currency?: string } | undefined;
    const vCurrency = vPrice?.currency || currency;
    const vAmount = typeof vPrice?.amount === "number" ? vPrice.amount : priceMinor;
    const availability = v.availability as { available?: boolean } | undefined;
    const sellerObj = v.seller as
      | { name?: string; domain?: string; url?: string }
      | undefined;
    const vOptions = Array.isArray(v.options)
      ? (v.options as Array<{ name?: string; label?: string }>).map((o) => ({
          name: String(o.name ?? "Option"),
          label: String(o.label ?? ""),
        }))
      : [];

    return {
      id: String(v.id ?? ""),
      title: String(v.title ?? raw.title ?? "Default"),
      available: availability?.available !== false,
      priceMinor: vAmount,
      currency: vCurrency,
      formattedPrice: formatMinorMoney(vAmount, vCurrency),
      checkoutUrl: typeof v.checkout_url === "string" ? v.checkout_url : null,
      productUrl: typeof v.url === "string" ? v.url : null,
      sellerDomain:
        typeof sellerObj?.domain === "string"
          ? sellerObj.domain
          : fallbackDomain ?? null,
      sellerName: typeof sellerObj?.name === "string" ? sellerObj.name : null,
      imageUrl: readImageUrl(v.media),
      options: vOptions,
    };
  });

  const firstVariantWithSeller = variants.find((v) => v.sellerName || v.sellerDomain);
  const firstVariantSellerRaw = rawVariants[0]?.seller as
    | { name?: string; domain?: string; url?: string }
    | undefined;
  const sellerDomain = firstVariantWithSeller?.sellerDomain ?? fallbackDomain ?? null;
  const sellerName =
    firstVariantWithSeller?.sellerName ??
    (fallbackDomain ? fallbackDomain.replace(/\.myshopify\.com$/, "") : "Shopify Store");
  const sellerUrl =
    typeof firstVariantSellerRaw?.url === "string"
      ? firstVariantSellerRaw.url
      : sellerDomain
        ? `https://${sellerDomain}`
        : null;

  const productImageUrl =
    readImageUrl(raw.media) ?? variants.find((v) => v.imageUrl)?.imageUrl ?? null;

  const rawRating = raw.rating as { value?: number; count?: number } | undefined;
  const rating =
    rawRating && typeof rawRating.value === "number"
      ? { value: Number(rawRating.value.toFixed(1)), count: Number(rawRating.count ?? 0) }
      : null;

  const firstSellerProductId = rawVariants.find(
    (v) => typeof v.seller_product_id === "string"
  )?.seller_product_id as string | undefined;

  return {
    id: String(raw.id ?? ""),
    sellerProductId:
      firstSellerProductId ??
      (String(raw.id ?? "").startsWith("gid://shopify/Product/") ? String(raw.id) : null),
    title: String(raw.title ?? "Untitled Product"),
    handle: String(raw.handle ?? ""),
    description: stripHtmlToText(descString).slice(0, 320),
    imageUrl: productImageUrl,
    priceMinor,
    maxPriceMinor,
    currency,
    formattedPrice:
      maxPriceMinor > priceMinor
        ? `${formatMinorMoney(priceMinor, currency)} – ${formatMinorMoney(maxPriceMinor, currency)}`
        : formatMinorMoney(priceMinor, currency),
    listPriceMinor,
    formattedListPrice: listPriceMinor ? formatMinorMoney(listPriceMinor, currency) : null,
    rating,
    highlights,
    seller: {
      name: sellerName,
      domain: sellerDomain,
      url: sellerUrl,
    },
    productUrl:
      typeof raw.url === "string"
        ? raw.url
        : variants.find((v) => v.productUrl)?.productUrl ?? null,
    variants,
  };
}

export async function searchShopifyCatalog(params: {
  target: McpTarget;
  query: string;
  limit?: number;
  cursor?: string;
  minPriceMinor?: number;
  maxPriceMinor?: number;
  currency?: string;
  country?: string;
  intent?: string;
}): Promise<{
  products: NormalizedProduct[];
  nextCursor: string | null;
  hasMore: boolean;
  trace: McpWireTrace;
}> {
  const catalogArgs: Record<string, unknown> = {
    query: params.query.trim() || "gift",
    pagination: {
      limit: Math.min(Math.max(params.limit ?? 12, 1), 48),
      ...(params.cursor ? { cursor: params.cursor } : {}),
    },
    context: {
      currency: params.currency || "USD",
      address_country: params.country || "US",
      language: "en-US",
      ...(params.intent ? { intent: params.intent } : {}),
    },
  };

  if (params.target.mode === "global" && process.env.SHOPIFY_CATALOG_ID?.trim()) {
    catalogArgs.catalog_id = process.env.SHOPIFY_CATALOG_ID.trim();
  }

  const priceFilter: Record<string, number> = {};
  if (typeof params.minPriceMinor === "number" && params.minPriceMinor >= 0) {
    priceFilter.min = Math.round(params.minPriceMinor);
  }
  if (typeof params.maxPriceMinor === "number" && params.maxPriceMinor > 0) {
    priceFilter.max = Math.round(params.maxPriceMinor);
  }
  if (Object.keys(priceFilter).length > 0) {
    catalogArgs.filters = { price: priceFilter };
  }

  const fallbackDomain =
    params.target.mode === "storefront"
      ? normalizeStoreDomain(params.target.domain)
      : undefined;

  const { payload, trace } = await callShopifyMcpRpc({
    target: params.target,
    method: "tools/call",
    params: {
      name: "search_catalog",
      arguments: {
        meta: buildUcpMeta(),
        catalog: catalogArgs,
      },
    },
  });

  const rawProducts = Array.isArray(payload.products)
    ? (payload.products as Array<Record<string, unknown>>)
    : [];
  const pagination = payload.pagination as
    | { end_cursor?: string; next_cursor?: string; cursor?: string; has_next_page?: boolean }
    | undefined;
  const nextCursor =
    pagination?.next_cursor || pagination?.end_cursor || pagination?.cursor || null;
  const hasMore = Boolean(pagination?.has_next_page ?? nextCursor);

  return {
    products: rawProducts.map((p) => normalizeUcpProduct(p, fallbackDomain)),
    nextCursor,
    hasMore,
    trace,
  };
}

export async function createOrUpdateStoreCart(params: {
  domain: string;
  cartId?: string;
  lineItems: Array<{ variantId: string; quantity: number; lineId?: string }>;
}): Promise<{ cart: NormalizedCart; trace: McpWireTrace }> {
  const cleanDomain = normalizeStoreDomain(params.domain);
  const formattedLines = params.lineItems.map((line) => ({
    ...(line.lineId ? { id: line.lineId } : {}),
    quantity: Math.max(1, Math.round(line.quantity)),
    item: { id: line.variantId },
  }));

  const isUpdate = Boolean(params.cartId);
  const { payload, trace } = await callShopifyMcpRpc({
    target: { mode: "storefront", domain: cleanDomain, surface: "ucp" },
    method: "tools/call",
    params: {
      name: isUpdate ? "update_cart" : "create_cart",
      arguments: {
        meta: buildUcpMeta(),
        ...(isUpdate ? { id: params.cartId } : {}),
        cart: {
          line_items: formattedLines,
        },
      },
    },
  });

  const currency = typeof payload.currency === "string" ? payload.currency : "USD";
  const totals = Array.isArray(payload.totals)
    ? (payload.totals as Array<{ type?: string; amount?: number }>)
    : [];
  const subtotalMinor = totals.find((t) => t.type === "subtotal")?.amount ?? 0;
  const totalMinor = totals.find((t) => t.type === "total")?.amount ?? subtotalMinor;

  const rawLines = Array.isArray(payload.line_items)
    ? (payload.line_items as Array<Record<string, unknown>>)
    : [];

  const lineItems: NormalizedCartLine[] = rawLines.map((line) => {
    const item = (line.item ?? {}) as {
      id?: string;
      title?: string;
      price?: number;
      image_url?: string;
    };
    const qty = typeof line.quantity === "number" ? line.quantity : 1;
    const unitPriceMinor = typeof item.price === "number" ? item.price : 0;
    const lineTotals = Array.isArray(line.totals)
      ? (line.totals as Array<{ type?: string; amount?: number }>)
      : [];
    const lineTotalMinor =
      lineTotals.find((t) => t.type === "total")?.amount ?? unitPriceMinor * qty;

    return {
      id: String(line.id ?? ""),
      variantId: String(item.id ?? ""),
      title: String(item.title ?? "Item"),
      quantity: qty,
      unitPriceMinor,
      lineTotalMinor,
      formattedUnitPrice: formatMinorMoney(unitPriceMinor, currency),
      formattedLineTotal: formatMinorMoney(lineTotalMinor, currency),
      imageUrl: typeof item.image_url === "string" ? item.image_url : null,
    };
  });

  return {
    cart: {
      id: String(payload.id ?? ""),
      domain: cleanDomain,
      currency,
      subtotalMinor,
      totalMinor,
      formattedSubtotal: formatMinorMoney(subtotalMinor, currency),
      formattedTotal: formatMinorMoney(totalMinor, currency),
      continueUrl: typeof payload.continue_url === "string" ? payload.continue_url : null,
      expiresAt: typeof payload.expires_at === "string" ? payload.expires_at : null,
      lineItems,
    },
    trace,
  };
}

export async function askStoreMcp(params: {
  domain: string;
  query: string;
  ids?: string[];
}): Promise<{ answer: string; trace: McpWireTrace }> {
  const cleanDomain = normalizeStoreDomain(params.domain);
  const validGids = (params.ids ?? [])
    .filter(
      (id) =>
        id.startsWith("gid://shopify/Product/") ||
        id.startsWith("gid://shopify/ProductVariant/") ||
        id.startsWith("gid://shopify/Collection/") ||
        id.startsWith("gid://shopify/Cart/")
    )
    .slice(0, 10);

  const { payload, trace } = await callShopifyMcpRpc({
    target: { mode: "storefront", domain: cleanDomain, surface: "ucp" },
    method: "tools/call",
    params: {
      name: "ask_business",
      arguments: {
        meta: buildUcpMeta(),
        ask: {
          query: params.query.trim(),
          ...(validGids.length > 0 ? { ids: validGids } : {}),
          context: {
            address_country: "US",
            currency: "USD",
            language: "en-US",
          },
        },
      },
    },
  });

  const answerObj = payload.answer as { plain?: string; markdown?: string } | string | undefined;
  const answerText =
    typeof answerObj === "string"
      ? answerObj
      : answerObj?.markdown || answerObj?.plain || "No answer returned by store MCP.";

  return { answer: answerText, trace };
}

export async function discoverMcpTools(target: McpTarget): Promise<{
  tools: McpToolSummary[];
  trace: McpWireTrace;
}> {
  const { payload, trace } = await callShopifyMcpRpc({
    target,
    method: "tools/list",
    params: {},
  });

  const rawTools = Array.isArray(payload.tools)
    ? (payload.tools as Array<Record<string, unknown>>)
    : [];

  const tools: McpToolSummary[] = rawTools.map((t) => {
    const schema = (t.inputSchema ?? {}) as Record<string, unknown>;
    const props = (schema.properties ?? {}) as Record<string, unknown>;
    const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
    return {
      name: String(t.name ?? ""),
      description: String(t.description ?? "").split("\n")[0] ?? "",
      requiredParams: required,
      topLevelProperties: Object.keys(props),
      inputSchema: schema,
    };
  });

  return { tools, trace };
}
