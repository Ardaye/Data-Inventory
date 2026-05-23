# Allo Inventory Reservation Demo

A Next.js demo for a reservation-first checkout flow. The app models inventory and reservations, blocks concurrent stock depletion on the last unit, and exposes a lightweight checkout experience for confirming or cancelling a reservation.

## What’s included

- Product and warehouse catalog with available stock per warehouse
- `POST /api/reservations` with concurrency-safe stock reservation logic
- `POST /api/reservations/:id/confirm` and `POST /api/reservations/:id/release`
- A product listing page and a reservation checkout page with a live countdown
- Prisma schema and seed script for a hosted Postgres database
- A `vercel.json` cron entry for expiry cleanup

## Local development

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Create a local environment file and add the variables you need:

```bash
copy NUL .env.local
```

Then add the following to `.env.local`:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DB_NAME
CRON_SECRET=optional-local-secret
```

Required variables:

- `DATABASE_URL` — Postgres connection string. If this is missing, the app falls back to an in-memory demo mode and does not persist reservations between restarts.
- `CRON_SECRET` — optional; used to protect the scheduled expiry cleanup route.

### 3. Apply the schema / run migrations

This project currently uses Prisma's schema sync for local development:

```bash
npm run db:push
```

If you prefer explicit migration files instead of `db push`, you can run:

```bash
npx prisma migrate dev --name init
```

Then continue to the seed step below.

### 4. Seed the database

```bash
npm run db:seed
```

### 5. Run the app

```bash
npm run dev
```

Open `http://localhost:3000`.

## Expiry mechanism

The app uses a dual approach to make expired reservations disappear safely and predictably:

1. **Lazy cleanup on reads** — every product list request calls the release routine before it queries current availability, so expired reservations are reclaimed as soon as the catalog is viewed.
2. **A scheduled cleanup route** — `vercel.json` defines a cron job hitting `/api/cron/release-expired` every 5 minutes. In production, this lets the system reclaim stale reservations even if no shopper is browsing the catalog.
3. **Server-side truth** — the client countdown is only a UX aid. The server decides whether a reservation is still valid and rejects or releases expired holds when the reservation is touched again.

### How expiry works in production

- Reservations are created with a fixed `10 minute` TTL.
- When a reservation is still `pending`, the server checks `expiresAt` before returning product availability or handling confirm/release operations.
- Expired pending reservations are moved to `released` and their `reservedUnits` are decremented in the database.
- The cron route at `/api/cron/release-expired` is protected by `CRON_SECRET` when that variable is set.
- If `DATABASE_URL` is not configured, the same expiry logic runs in-memory for the current process only.

## Trade-offs and what I would improve with more time

### Trade-offs made

- **Prisma `db push` for local development**: this is faster for a demo, but it is less explicit than managing migration files in version control.
- **In-memory fallback when `DATABASE_URL` is absent**: this makes the demo easy to run locally without a database, but it is not suitable for production or multi-instance deployments.
- **Lazy cleanup + cron cleanup**: this keeps the implementation simple and reliable without requiring a background worker or a separate scheduler service.
- **Client countdown for UX**: the countdown makes the flow feel immediate, but the server remains the source of truth for expiry and state transitions.

### Things I would do differently with more time

- Add a proper migration workflow and commit the generated Prisma migration files.
- Introduce a background worker or job queue for more deterministic expiry processing at scale.
- Add better observability around cleanup, retries, and idempotency conflicts.
- Add a stronger API contract for expiry and idempotency errors, including clearer UI states and retry guidance.
- Consider a dedicated reservation service or event-driven inventory ledger if the demo evolves into a high-volume production workload.

## Idempotency

The reserve and confirm endpoints support idempotency using an `Idempotency-Key` header.

### How it works

1. The server computes a stable request hash from the endpoint-specific payload.
2. It stores the key, the request hash, and the response metadata in an `IdempotencyKey` table when `DATABASE_URL` is available.
3. On retries with the **same** key and **same** payload, the server returns the original stored response and does **not** repeat the side effect.
4. If the same key is reused with a different payload, the server returns `409 Conflict`.
5. When `DATABASE_URL` is not configured, the same behavior is handled in-memory for the current process, so your local demo still behaves correctly without a database.

### What is stored

- `operation` — `reserve` or `confirm`
- `requestHash` — a stable hash of the request inputs
- `status` — `in_progress`, `completed`, or `failed`
- `responseStatus` — the original HTTP status code
- `responseBody` — the original JSON response body

### How to use it

Send the same `Idempotency-Key` header on retried requests:

```bash
curl -X POST http://localhost:3000/api/reservations \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: reserve-123" \
  -d '{"productId":"prod-1","warehouseId":"wh-1","quantity":1}'
```

If the request is retried with the same header and payload, the server returns the original response instead of creating a second reservation.

## Deployment

1. Create a hosted Postgres instance (Supabase, Neon, Railway, etc.)
2. Add `DATABASE_URL` and `CRON_SECRET` to your Vercel environment
3. Run `npm run db:push` (or `npx prisma migrate dev` if you prefer migrations) and `npm run db:seed` in the deployment environment
4. Deploy the app

## Notes

- The demo uses a 10-minute reservation TTL.
- `GET /api/products` returns warehouse-level availability, and the UI uses that data to render Reserve buttons.
- The `409` and `410` paths are surfaced visibly in the UI so the user sees why a reservation could not proceed.
