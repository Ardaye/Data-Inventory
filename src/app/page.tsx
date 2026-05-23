import { ProductCatalog } from "@/components/product-catalog";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-10 sm:px-6 lg:px-8">
      <ProductCatalog />
    </main>
  );
}
