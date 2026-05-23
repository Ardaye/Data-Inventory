"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type ReservationPayload = {
  id: string;
  quantity: number;
  status: string;
  expiresAt: string;
  inventory: {
    product: {
      name: string;
      sku: string;
    };
    warehouse: {
      name: string;
      code: string;
    };
  };
};

type ActionState = {
  loading: boolean;
  message?: string;
  error?: string;
};

export function ReservationCheckout({ reservationId }: { reservationId: string }) {
  const [reservation, setReservation] = useState<ReservationPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<ActionState>({ loading: false });
  const [releaseState, setReleaseState] = useState<ActionState>({ loading: false });

  async function loadReservation() {
    setLoading(true);

    try {
      const response = await fetch(`/api/reservations/${reservationId}`);

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Unable to load reservation");
      }

      const payload = (await response.json()) as ReservationPayload;
      setReservation(payload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load reservation");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadReservation();
  }, [reservationId]);

  const countdown = useMemo(() => {
    if (!reservation) {
      return "--";
    }

    const remainingMs = new Date(reservation.expiresAt).getTime() - Date.now();

    if (remainingMs <= 0) {
      return "0s";
    }

    const totalSeconds = Math.floor(remainingMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    return `${minutes}m ${seconds}s`;
  }, [reservation]);

  useEffect(() => {
    if (!reservation) {
      return;
    }

    const interval = window.setInterval(() => {
      const remainingMs = new Date(reservation.expiresAt).getTime() - Date.now();

      if (remainingMs <= 0) {
        setReservation((current) =>
          current
            ? {
                ...current,
                status: "expired",
              }
            : current,
        );
        window.clearInterval(interval);
      }
    }, 1000);

    return () => window.clearInterval(interval);
  }, [reservation]);

  async function confirmPurchase() {
    setConfirmState({ loading: true, message: "Confirming purchase..." });

    try {
      const response = await fetch(`/api/reservations/${reservationId}/confirm`, {
        method: "POST",
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error ?? "Unable to confirm the reservation");
      }

      setReservation((current) =>
        current
          ? {
              ...current,
              status: "confirmed",
            }
          : current,
      );
      setConfirmState({ loading: false, message: "Purchase confirmed. Stock has been permanently deducted." });
      setReleaseState({ loading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to confirm the reservation";
      setConfirmState({ loading: false, error: message });
      setError(message);
      setReservation((current) =>
        current
          ? {
              ...current,
              status: message.toLowerCase().includes("expired") ? "expired" : current.status,
            }
          : current,
      );
    }
  }

  async function cancelReservation() {
    setReleaseState({ loading: true, message: "Releasing reservation..." });

    try {
      const response = await fetch(`/api/reservations/${reservationId}/release`, {
        method: "POST",
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error ?? "Unable to release reservation");
      }

      setReservation((current) =>
        current
          ? {
              ...current,
              status: "released",
            }
          : current,
      );
      setReleaseState({ loading: false, message: "Reservation released. The units are available again." });
      setConfirmState({ loading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to release reservation";
      setReleaseState({ loading: false, error: message });
      setError(message);
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-slate-600">Loading reservation...</p>
      </div>
    );
  }

  if (error || !reservation) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-700">
        <p className="font-semibold">We could not load the reservation.</p>
        <p className="mt-2">{error ?? "Reservation not found."}</p>
        <Link href="/" className="mt-4 inline-flex text-sm font-semibold text-blue-700">
          Return to catalog
        </Link>
      </div>
    );
  }

  const isTerminal = reservation.status === "confirmed" || reservation.status === "released" || reservation.status === "expired";

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-600">Checkout</p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">Reservation details</h1>
        <p className="mt-3 text-sm text-slate-600">
          This hold expires automatically. Confirm the purchase before the timer hits zero, or release it to make the stock available again.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <dl className="space-y-4 text-sm text-slate-700">
            <div className="flex justify-between gap-4">
              <dt className="font-semibold text-slate-900">Product</dt>
              <dd>{reservation.inventory.product.name}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="font-semibold text-slate-900">SKU</dt>
              <dd>{reservation.inventory.product.sku}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="font-semibold text-slate-900">Warehouse</dt>
              <dd>{reservation.inventory.warehouse.name} ({reservation.inventory.warehouse.code})</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="font-semibold text-slate-900">Quantity</dt>
              <dd>{reservation.quantity}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="font-semibold text-slate-900">Status</dt>
              <dd className="font-semibold capitalize text-slate-900">{reservation.status}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Time remaining</p>
          <p className="mt-3 text-4xl font-semibold text-slate-900">{countdown}</p>
          <p className="mt-3 text-sm text-slate-600">
            {reservation.status === "confirmed"
              ? "This reservation has been confirmed and the stock is now permanently deducted."
              : reservation.status === "released"
                ? "This reservation has been released back to inventory."
                : reservation.status === "expired"
                  ? "This reservation has expired and has been released automatically."
                  : "Complete payment before the hold expires to avoid losing the reservation."}
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void confirmPurchase()}
            disabled={isTerminal || confirmState.loading}
            className="inline-flex items-center rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {confirmState.loading ? "Confirming..." : "Confirm purchase"}
          </button>
          <button
            type="button"
            onClick={() => void cancelReservation()}
            disabled={isTerminal || releaseState.loading}
            className="inline-flex items-center rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100"
          >
            {releaseState.loading ? "Releasing..." : "Cancel"}
          </button>
          <Link href="/" className="text-sm font-semibold text-blue-700">
            Back to products
          </Link>
        </div>

        {confirmState.message ? (
          <p className="mt-3 text-sm text-emerald-700">{confirmState.message}</p>
        ) : null}
        {releaseState.message ? (
          <p className="mt-3 text-sm text-slate-700">{releaseState.message}</p>
        ) : null}
        {confirmState.error ? <p className="mt-3 text-sm text-rose-600">{confirmState.error}</p> : null}
        {releaseState.error ? <p className="mt-3 text-sm text-rose-600">{releaseState.error}</p> : null}
      </div>
    </div>
  );
}
