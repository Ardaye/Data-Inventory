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

Copy `.env.example` to `.env.local` and fill in a hosted Postgres URL.

```bash
cp .env.example .env.local
```

Required variables:

- `DATABASE_URL` — a hosted Postgres connection string
- `CRON_SECRET` — optional, used to protect the expiry cleanup route

### 3. Apply the schema

```bash
npm run db:push
```

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

The app uses a dual approach:

1. **Lazy cleanup on reads** — every product list request calls the release routine before it queries current availability, so expired reservations are reclaimed as soon as the catalog is viewed.
2. **A scheduled cleanup route** — `vercel.json` defines a cron job hitting `/api/cron/release-expired` every 5 minutes. In production, this lets the system reclaim stale reservations even if no shopper is browsing the catalog.

If you want a stricter production setup, you can tune the clean-up frequency and add an internal auth check for the cron route.

## Trade-offs

- The current implementation uses a single Prisma-backed Postgres transaction with row locks for the critical paths. This keeps the reservation logic correct under concurrency without introducing a separate locking service.
- The checkout page uses a client-side countdown to make the UX feel immediate, while the server remains the source of truth for actual expiry and release behavior.
- The bonus idempotency work is not implemented in this version. If you want it, the natural extension is an `IdempotencyKey` table plus a request hash check on `POST /api/reservations` and `POST /api/reservations/:id/confirm`.

## Deployment

1. Create a hosted Postgres instance (Supabase, Neon, Railway, etc.)
2. Add `DATABASE_URL` and `CRON_SECRET` to your Vercel environment
3. Run `npm run db:push` and `npm run db:seed` in the deployment environment
4. Deploy the app

## Notes

- The demo uses a 10-minute reservation TTL.
- `GET /api/products` returns warehouse-level availability, and the UI uses that data to render Reserve buttons.
- The `409` and `410` paths are surfaced visibly in the UI so the user sees why a reservation could not proceed.
