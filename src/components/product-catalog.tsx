"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

type WarehouseAvailability = {
  warehouseId: string;
  warehouseName: string;
  warehouseCode: string;
  totalUnits: number;
  reservedUnits: number;
  availableUnits: number;
};

type Product = {
  id: string;
  name: string;
  sku: string;
  description: string | null;
  warehouses: WarehouseAvailability[];
};

type ReserveState = {
  status: "idle" | "loading" | "success" | "error";
  message?: string;
};

export function ProductCatalog() {
  const router = useRouter();
  const pathname = usePathname();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reserveState, setReserveState] = useState<Record<string, ReserveState>>({});

  async function loadProducts() {
    setLoading(true);

    try {
      const response = await fetch("/api/products");

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Failed to load products");
      }

      const payload = (await response.json()) as Product[];
      setProducts(payload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load products");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProducts();
  }, [pathname]);

  const totals = useMemo(() => {
    const totalAvailable = products.reduce(
      (sum, product) =>
        sum + product.warehouses.reduce((warehouseSum, warehouse) => warehouseSum + warehouse.availableUnits, 0),
      0,
    );

    return { totalAvailable };
  }, [products]);

  async function reserve(productId: string, warehouseId: string) {
    setReserveState((current) => ({
      ...current,
      [productId + warehouseId]: { status: "loading", message: "Reserving units..." },
    }));

    try {
      const response = await fetch("/api/reservations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          productId,
          warehouseId,
          quantity: 1,
        }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error ?? "Unable to reserve units.");
      }

      setReserveState((current) => ({
        ...current,
        [productId + warehouseId]: { status: "success", message: "Reservation created. Redirecting to checkout..." },
      }));

      await loadProducts();
      router.push(`/reservations/${payload.id}`);
    } catch (err) {
      setReserveState((current) => ({
        ...current,
        [productId + warehouseId]: {
          status: "error",
          message: err instanceof Error ? err.message : "Unable to reserve units.",
        },
      }));
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-slate-600">Loading inventory...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-700">
        <p className="font-semibold">We hit an issue loading the catalog.</p>
        <p className="mt-2">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-600">Live reservation view</p>
            <h1 className="mt-2 text-3xl font-semibold text-slate-900">Inventory and checkout reservations</h1>
            <p className="mt-3 max-w-2xl text-sm text-slate-600">
              Reserve units for a warehouse, confirm the hold after payment, or release it if the buyer backs out. Expired reservations are cleaned up automatically for the next shopper.
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
            <div className="font-semibold text-slate-900">Available units right now</div>
            <div className="mt-1">{totals.totalAvailable}</div>
          </div>
        </div>
      </div>

      <div className="grid gap-4">
        {products.map((product) => (
          <article key={product.id} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">{product.sku}</p>
                <h2 className="mt-2 text-xl font-semibold text-slate-900">{product.name}</h2>
                <p className="mt-2 text-sm text-slate-600">{product.description}</p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {product.warehouses.map((warehouse) => {
                const key = product.id + warehouse.warehouseId;
                const state = reserveState[key];

                return (
                  <div key={warehouse.warehouseId} className="rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-900">{warehouse.warehouseName}</p>
                        <p className="text-sm text-slate-500">{warehouse.warehouseCode}</p>
                      </div>
                      <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700">
                        {warehouse.availableUnits} available
                      </span>
                    </div>
                    <div className="mt-3 text-sm text-slate-600">
                      <div>Total units: {warehouse.totalUnits}</div>
                      <div>Currently reserved: {warehouse.reservedUnits}</div>
                    </div>

                    <button
                      type="button"
                      onClick={() => reserve(product.id, warehouse.warehouseId)}
                      disabled={warehouse.availableUnits < 1 || state?.status === "loading"}
                      className="mt-4 inline-flex items-center rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      {state?.status === "loading" ? "Reserving..." : "Reserve"}
                    </button>

                    {state?.message ? (
                      <p
                        className={`mt-3 text-sm ${
                          state.status === "error" ? "text-rose-600" : "text-slate-600"
                        }`}
                      >
                        {state.message}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
