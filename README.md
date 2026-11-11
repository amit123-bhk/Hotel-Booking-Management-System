# Grand Horizon Hotel — Reservations and Property Operations Platform

A full-stack, MongoDB-backed hotel booking and property operations web application featuring a dedicated landing page, guest login and account registration, concurrency-safe room holds, server-side RBAC, sandbox payments, operations reporting, and an automated test suite.

---

## Key Features

### Public Landing & Guest Experience
- **Hotel Landing Page (`/`)**: Split architectural hero, quick availability bar, live room category previews loaded from MongoDB, and guest policies.
- **Account Login & Registration Page (`/login`, `/register`)**: Persistent guest account creation (`POST /api/auth/register`) and sign-in (`POST /api/auth/login`) backed by MongoDB `users` collection using PBKDF2-SHA512 salted password hashes and HMAC-SHA256 JWT tokens.
- **Availability Search (`/rooms`)**: Search by check-in/check-out dates, adult/child occupancy, and room types. Rejects invalid/past dates and excludes rooms in maintenance.
- **10-Minute Exclusive Room Holds**: Locks an available physical room during checkout with a live countdown timer; expired holds automatically stop blocking inventory.
- **Itemized Pricing Engine**: Computes nightly rates, weekend surcharges (+15% Fri-Sat), seasonal modifiers, optional add-ons, occupancy taxes (12%), and service fees ($25/night).
- **Simulated Sandbox Checkout**: Supports idempotent booking confirmations (`Idempotency-Key` header), test cards (`4242...` approves, `4000...` declines), and printable booking vouchers (`BK-2026-XXXX`).
- **Booking History (`/bookings`)**: Authenticated guests automatically see their stored bookings linked to their `user_id` and email in MongoDB, look up bookings by reference, and process self-cancellations with sandbox refunds.

### Staff & Admin Operations
- **Server-Side RBAC**: Protected routes enforce `GUEST`, `STAFF`, and `ADMIN` roles server-side.
- **Front Desk Console (`/front-desk`)**: Filter/search bookings and execute 1-click Check-In (`CONFIRMED -> CHECKED_IN`, room -> `OCCUPIED`) and Check-Out (`CHECKED_IN -> CHECKED_OUT`, room -> `CLEANING`).
- **Housekeeping Board (`/housekeeping`)**: Floor-by-floor live room grid (`AVAILABLE`, `OCCUPIED`, `CLEANING`, `MAINTENANCE`, `OUT_OF_ORDER`).
- **Operations Reporting (`/reports`)**: Date-range KPIs (Occupancy %, ADR, RevPAR, Total Revenue, Upcoming Arrivals/Departures, Room Type Breakdown) reconciled from MongoDB `reservations`.
- **Room & Rate Admin (`/admin/rooms`)**: Create room types and add physical room units.
- **Audit Trail (`/admin/audit`)**: Records material business actions in MongoDB `audit_logs`.

---

## Architecture & Directory Structure

```text
hotel-booking-app/
├── server/
│   ├── db/
│   │   ├── database.js           # MongoDB connection, indexes & concurrency lock
│   │   └── seed.js               # Idempotent MongoDB seed script
│   ├── services/                 # Business logic (auth, availability, pricing, booking, rooms, reporting, audit)
│   ├── middleware/               # JWT auth, RBAC guards, error handler
│   ├── routes/                   # REST endpoints (auth, rooms, bookings, reports, audit)
│   ├── docs/openapi.json         # OpenAPI 3.0 specification
│   ├── app.js                    # Express 5 application & Swagger UI (/api/docs)
│   └── server.js                 # Server entrypoint
├── client/
│   ├── index.html                # Landing page, Login/Register page, Booking & Operations views
│   ├── app.js                    # Client router, auth state, booking & staff modules
│   └── styles.css                # High-contrast daylight styles & print voucher CSS
├── tests/
│   ├── unit.test.js              # Pricing, date validation, password/JWT unit tests
│   └── integration.test.js       # End-to-end MongoDB acceptance, concurrency, registration & RBAC tests
├── docs/                         # ER diagram, technical report, submission form
├── .env.example                  # Placeholder environment variables
└── package.json
```

---

## Prerequisites & Local Setup

- **Node.js**: `v20+` (verified on `v22.14.0`)
- **MongoDB**: Local MongoDB Server running on `127.0.0.1:27017` (verified on MongoDB `8.2`)

### 1. Install Dependencies
```bash
npm install
```

### 2. Environment Variables
Copy `.env.example` to `.env` if customizing connection settings (defaults to `mongodb://127.0.0.1:27017` / `grand_horizon_hotel`):
```bash
cp .env.example .env
```

### 3. Seed MongoDB
```bash
npm run seed
```

### 4. Start the Application
```bash
npm start
```
- **Landing Page**: `http://localhost:3000/`
- **Login / Register Page**: `http://localhost:3000/login`
- **Rooms & Booking**: `http://localhost:3000/rooms`
- **API Docs**: `http://localhost:3000/api/docs`
- **Health Check**: `http://localhost:3000/api/health`

### 5. Run Automated Tests
```bash
npm test
```
Tests run against isolated MongoDB test databases (`grand_horizon_test_unit` and `grand_horizon_test_integration`).

---

## Seeded Accounts

| Role | Email | Password |
| :--- | :--- | :--- |
| **Admin** | `admin@grandhorizon.com` | `Admin123!` |
| **Staff** | `staff@grandhorizon.com` | `Staff123!` |
| **Guest** | `guest@example.com` | `Guest123!` |
