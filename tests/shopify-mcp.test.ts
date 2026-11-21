import assert from "node:assert/strict";
import test from "node:test";
import {
  createOrUpdateStoreCart,
  discoverMcpTools,
  formatMinorMoney,
  normalizeStoreDomain,
  normalizeUcpProduct,
  resolveMcpEndpoint,
  searchShopifyCatalog,
  stripHtmlToText,
} from "../src/lib/shopify-mcp.ts";

test("formatMinorMoney converts minor units across decimal conventions", () => {
  assert.equal(formatMinorMoney(3999, "USD"), "$39.99");
  assert.equal(formatMinorMoney(2500, "JPY"), "¥2,500");
  assert.equal(formatMinorMoney(1500, "KWD"), "KWD\u00a01.500");
});

test("normalizeStoreDomain strips schemes/paths and blocks SSRF hostnames", () => {
  assert.equal(
    normalizeStoreDomain("https://3j6yup-ku.myshopify.com/products/test?x=1"),
    "3j6yup-ku.myshopify.com"
  );
  assert.equal(normalizeStoreDomain("Allbirds.com"), "allbirds.com");

  assert.throws(() => normalizeStoreDomain("localhost"));
  assert.throws(() => normalizeStoreDomain("127.0.0.1"));
  assert.throws(() => normalizeStoreDomain("opens-mac-studio.local"));
  assert.throws(() => normalizeStoreDomain("example.com:8080"));
});

test("resolveMcpEndpoint maps global and storefront UCP endpoints", () => {
  assert.equal(
    resolveMcpEndpoint({ mode: "global" }),
    "https://catalog.shopify.com/api/ucp/mcp"
  );
  assert.equal(
    resolveMcpEndpoint({ mode: "storefront", domain: "3j6yup-ku.myshopify.com" }),
    "https://3j6yup-ku.myshopify.com/api/ucp/mcp"
  );
  assert.equal(
    resolveMcpEndpoint({
      mode: "storefront",
      domain: "3j6yup-ku.myshopify.com",
      surface: "legacy",
    }),
    "https://3j6yup-ku.myshopify.com/api/mcp"
  );
});

test("normalizeUcpProduct extracts clean text, pricing, seller, and variants", () => {
  const product = normalizeUcpProduct({
    id: "gid://shopify/p/abc",
    title: "Test Prize Keyboard",
    handle: "test-prize-keyboard",
    description: { plain: "<div><h2>Compact</h2><p>Hot-swappable &amp; quiet.</p></div>" },
    price_range: {
      min: { amount: 4999, currency: "USD" },
      max: { amount: 5999, currency: "USD" },
    },
    media: [{ type: "image", url: "https://cdn.shopify.com/test.jpg" }],
    rating: { value: 4.76, count: 42 },
    variants: [
      {
        id: "gid://shopify/ProductVariant/12345",
        title: "White / Linear",
        price: { amount: 4999, currency: "USD" },
        availability: { available: true },
        seller: { name: "Test Brand", domain: "test-brand.myshopify.com" },
        checkout_url: "https://test-brand.myshopify.com/buy/12345:1",
      },
    ],
  });

  assert.equal(product.formattedPrice, "$49.99 – $59.99");
  assert.equal(product.seller.domain, "test-brand.myshopify.com");
  assert.equal(product.seller.name, "Test Brand");
  assert.equal(product.rating?.value, 4.8);
  assert.equal(stripHtmlToText("<p>Hello &amp; world</p>"), "Hello & world");
  assert.equal(product.description, "Compact Hot-swappable & quiet.");
});

test("live Shopify MCP integration: Global Catalog search + Storefront create_cart", async () => {
  const toolsRes = await discoverMcpTools({ mode: "global" });
  assert.ok(toolsRes.tools.some((t) => t.name === "search_catalog"));

  const searchRes = await searchShopifyCatalog({
    target: { mode: "storefront", domain: "3j6yup-ku.myshopify.com" },
    query: "stand",
    limit: 2,
  });
  assert.ok(searchRes.products.length > 0, "Expected products from Storefront UCP MCP");

  const firstVariant = searchRes.products[0]?.variants[0];
  assert.ok(firstVariant?.id, "Expected variant GID");

  const cartRes = await createOrUpdateStoreCart({
    domain: "3j6yup-ku.myshopify.com",
    lineItems: [{ variantId: firstVariant.id, quantity: 1 }],
  });
  assert.ok(cartRes.cart.id.startsWith("gid://shopify/Cart/"));
  assert.ok(cartRes.cart.continueUrl?.startsWith("https://"));
});
