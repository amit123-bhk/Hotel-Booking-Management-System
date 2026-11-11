# Technical Architecture & Engineering Report
**Project Title**: Grand Horizon Luxury Hotel & Resort Management & Booking Platform  
**Domain**: Hotel Booking & Property Operations  

---

## 1. Architectural Overview (Modular Monolith)
The system is structured as a layered modular monolith separating Presentation, Business Logic Services, Middleware/Security, and Persistence:

```
┌────────────────────────────────────────────────────────────────┐
│                     Client SPA (HTML / Tailwind / JS)          │
│  [Guest Search & Hold]  [Front Desk]  [Housekeeping]  [Reports] │
└───────────────────────────────┬────────────────────────────────┘
                                │ REST JSON + Bearer JWT + Idempotency-Key
┌───────────────────────────────▼────────────────────────────────┐
│                  Express API Layer & OpenAPI Docs              │
│     [Auth Middleware]  [RBAC Guards]  [Central Error Handler]  │
├────────────────────────────────────────────────────────────────┤
│                      Business Logic Services                   │
│  • availabilityService  (Overlap checks & expired hold rules)  │
│  • pricingService       (Weekend/Seasonal rates, taxes, fees)  │
│  • bookingService       (State machine, 10-min holds, refunds) │
│  • roomService          (Room types & housekeeping grid)       │
│  • reportingService     (Occupancy %, ADR, RevPAR, revenue)    │
│  • auditService         (Immutable trail for critical actions) │
├────────────────────────────────────────────────────────────────┤
│                 Persistence Layer (SQLite WAL)                 │
│     • BEGIN IMMEDIATE TRANSACTION locking                      │
│     • Foreign keys, CHECK constraints, unique indexes          │
└────────────────────────────────────────────────────────────────┘
```

### Why this architecture?
- **Clear Separation of Concerns**: Routes handle only HTTP parsing/status codes; Services encapsulate 100% of business rules and transaction boundaries; Database layer exposes clean prepared-statement wrappers.
- **Zero-Config Reproducibility**: Built on Node.js v22 (`node:sqlite` + `node:crypto` + `node:test`) and Express 5, eliminating external DB server dependencies while preserving ACID transactions, WAL-mode concurrency, and strict SQL relational integrity.

---

## 2. Concurrency Control & Double-Booking Prevention

### The Problem
Two concurrent guests search for the last available room of a given type for overlapping dates (e.g., Guest A requests `Nov 20–23`, Guest B requests `Nov 21–24`). Without proper locking, both read "1 room available" and both proceed to book the same physical room.

### Implemented Solution
1. **10-Minute Exclusive Temporary Holds**:
   - When a user initiates checkout, `bookingService.createHold()` wraps availability check + room assignment + insertion inside SQLite's `BEGIN IMMEDIATE TRANSACTION`.
   - `BEGIN IMMEDIATE` acquires an exclusive write lock immediately at transaction start, serializing concurrent booking attempts at the database engine level.
   - If the second request executes after the first commits, `findAvailableRoomForType()` detects the active `HOLD` (or `CONFIRMED`) overlap `(check_in < search_out AND check_out > search_in)` and returns `409 Conflict`.
2. **Automatic Non-Blocking Expired Holds**:
   - Holds store an explicit UTC ISO timestamp `hold_expires_at` (`NOW + 10 minutes`).
   - Availability queries evaluate:
     ```sql
     res.status IN ('CONFIRMED', 'CHECKED_IN')
     OR (res.status = 'HOLD' AND res.hold_expires_at > datetime('now'))
     ```
   - Any hold whose `hold_expires_at <= datetime('now')` is immediately ignored during room searches—no background cron lag can leave rooms phantom-blocked.
3. **Idempotent Payment Confirmations**:
   - Payment submission accepts an `Idempotency-Key` HTTP header stored under a `UNIQUE` constraint on `reservations.idempotency_key`.
   - Network retries with the same key return the existing confirmed reservation without creating duplicate `payments` rows.

---

## 3. Reservation State Machine & Integrity
State transitions are enforced server-side inside atomic transactions:

- `HOLD` → `CONFIRMED` (valid only if `now <= hold_expires_at` and simulated card authorizes)
- `HOLD` → `EXPIRED` (if confirmation is attempted after expiration)
- `HOLD` / `CONFIRMED` → `CANCELLED` (releases room inventory; triggers simulated refund in `payments` table)
- `CONFIRMED` → `CHECKED_IN` (Staff/Admin action; transitions physical room status to `OCCUPIED`)
- `CHECKED_IN` → `CHECKED_OUT` (Staff/Admin action; transitions physical room status to `CLEANING` for housekeeping turnover)

Illegal transitions (e.g., checking in a `CANCELLED` reservation, cancelling a `CHECKED_IN` reservation, or double check-in) are rejected with explicit `400 Bad Request` errors.

---

## 4. Security & Server-Side RBAC
- **Password Storage**: Salted PBKDF2-SHA512 (`10,000` iterations, 16-byte random salt) verified with constant-time `crypto.timingSafeEqual`.
- **Stateless Signed Tokens**: HMAC-SHA256 signed JWTs containing `id`, `email`, `role`, and expiration (`exp`).
- **Server-Side Enforcement**: UI tabs adapt to roles, and every protected API endpoint enforces `requireAuth` and `requireRole('STAFF', 'ADMIN')` or `requireRole('ADMIN')`. Guest cancellation additionally verifies ownership (`user_id` or `guest_email` match).

---

## 5. Operations Reporting Reconciliation
The Operations Report (`reportingService.getOperationsReport`) computes KPIs directly from live database records for any chosen `[start_date, end_date]` window:
- **Occupied Room Nights**: Sum of stay nights overlapping `[start_date, end_date]` across `CONFIRMED`, `CHECKED_IN`, and `CHECKED_OUT` bookings.
- **Occupancy Rate (%)**: `(Occupied Room Nights / (Total Active Rooms × Days in Period)) × 100`.
- **ADR (Average Daily Rate)**: `Total Revenue / Occupied Room Nights`.
- **RevPAR**: `Total Revenue / Total Available Room Nights`.

---

## 6. Known Limitations & Trade-Offs
1. **SQLite Single-Writer Concurrency**: `BEGIN IMMEDIATE` guarantees zero race conditions on a single-node modular monolith; scaling horizontally across multiple stateless server containers would require migrating the persistence adapter to PostgreSQL with `EXCLUDE USING GIST` range constraints.
2. **Simulated Payment Gateway**: Card processing is sandboxed locally (test card `4242...` succeeds; `4000...` declines) rather than connected to a live Stripe/Adyen webhook.
3. **Frontend Buildless Architecture**: Uses Vanilla ES6+ and Tailwind CSS CDN instead of a Vite/Webpack bundle for instant zero-install execution on any local environment.
4. **Experimental SQLite Flag**: Uses Node.js v22 built-in `node:sqlite`, which emits an `ExperimentalWarning` on startup (`--experimental-sqlite`).
