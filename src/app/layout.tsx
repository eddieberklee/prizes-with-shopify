import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prizes with Shopify · MCP Studio",
  description:
    "Discover products, curate prize pools, draw winners, and mint live Shopify carts over Shopify Global Catalog & Storefront UCP MCP.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#0b0d10] text-zinc-100 selection:bg-emerald-500/30 selection:text-emerald-200">
        {children}
      </body>
    </html>
  );
}
