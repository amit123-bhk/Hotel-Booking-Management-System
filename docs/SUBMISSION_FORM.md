# Submission Form & Demo Walkthrough Guide

## 1. Submission Form Entries (Section 5 Reference)

| Form Section | Entry / Details |
| :--- | :--- |
| **Candidate Identification** | Full Name: `[Enter Full Name]` <br> Registration Number: `[Enter Registration Number]` <br> University Email: `[Enter University Email]` |
| **Assignment Confirmation** | Role: Full-Stack / Software Engineering Intern <br> Assigned Project Title: **Hotel Booking (Grand Horizon Luxury Hotel & Resort)** |
| **Code & Version** | Repository URL: `[Your Git Repository URL]` <br> Primary Branch: `main` <br> Final Commit ID: `[Run git rev-parse HEAD after final commit]` |
| **Demonstration** | Demo Type: **Local-only Demo** (`http://localhost:3000`) <br> 3–5 Minute Walkthrough Video Link: `[Upload & paste Google Drive / Loom / YouTube unlisted link]` |
| **Documentation** | README: `/README.md` <br> Technical Report: `/docs/TECHNICAL_REPORT.md` <br> ER / Schema Diagram: `/docs/ER_DIAGRAM.md` <br> API Documentation: `http://localhost:3000/api/docs` (OpenAPI Spec: `/server/docs/openapi.json`) |
| **Technology & Limitations** | **Stack**: Node.js v22 (`node:sqlite`, `node:crypto`, `node:test`), Express 5, SQLite (WAL mode), Tailwind CSS, Vanilla ES6+ SPA, OpenAPI 3.0 / Swagger UI. <br> **Known Limitations**: Single-node SQLite concurrency; sandbox simulated payment gateway only; no live SMTP email dispatch; uses Node v22 `--experimental-sqlite` flag. |
| **AI & Attribution** | **AI Tools Used**: Antigravity AI coding assistant used for architecture scaffolding, test design, and documentation review. <br> **Libraries/Assets**: Express 5, Tailwind CSS CDN, Lucide Icons, Swagger UI CDN, Unsplash stock photography URLs. |
| **Declarations** | Original work verified; all code and concurrency/database logic understood and explainable; no real secrets/passwords/live payment keys committed (`.env.example` only); dummy credentials only. |

---

## 2. Demo Credentials & Role-Based Testing

The application includes a **1-Click Reviewer Demo Bar** at the top of the UI, or you can sign in manually:

| Role | Email | Password | Permissions |
| :--- | :--- | :--- | :--- |
| **ADMIN** | `admin@grandhorizon.com` | `Admin123!` | Full access: Room & rate admin, operations reports, audit logs, front desk, housekeeping |
| **STAFF** | `staff@grandhorizon.com` | `Staff123!` | Front desk bookings, check-in/check-out, room housekeeping grid, operations report |
| **GUEST** | `guest@example.com` | `Guest123!` | Room search, temporary holds, sandbox checkout, booking history, self-cancellation |

---

## 3. 3–5 Minute Demo Video Walkthrough Script

1. **0:00 – 0:45 | Introduction & Architecture**:
   - Show the running application at `http://localhost:3000` and briefly mention the modular monolith structure (`server/services`, `server/db`, `server/routes`, `client/`).
2. **0:45 – 2:00 | End-to-End Customer Journey**:
   - Search availability for valid check-in/check-out dates and guests.
   - Select a suite, add optional add-ons (Gourmet Breakfast), inspect itemized tax & fee breakdown.
   - Click **Proceed to Hold & Payment** → highlight the live **10-minute room hold countdown timer**.
   - Show sandbox declined card (`4000...`) failure, then complete booking with test card (`4242...`) → view Printable Voucher & unique `BK-2026-XXXX` reference.
   - Open **My Bookings** to verify booking history.
3. **2:00 – 3:15 | Staff Front Desk & Housekeeping Workflow**:
   - Click **Staff: Sarah (Front Desk)** in the top Reviewer Demo Bar.
   - Search for the newly created booking in **Front Desk**, click **Check In** → room transitions to `OCCUPIED`.
   - Switch to **Housekeeping**, show floor-by-floor room grid, then return to Front Desk and click **Check Out** → show room automatically moves to `CLEANING`. Mark it `AVAILABLE` in Housekeeping.
4. **3:15 – 4:15 | Admin Operations Report & Audit Trail**:
   - Click **Admin: Alexander (GM)** in the Demo Bar.
   - Open **Operations Report**: verify Occupancy Rate %, Revenue, ADR, RevPAR, Upcoming Arrivals/Departures match underlying reservations.
   - Open **Audit Logs** to show tamper-evident action logs (`BOOKING_HOLD_PLACED`, `BOOKING_CONFIRMED`, `GUEST_CHECKIN`, `GUEST_CHECKOUT`, `ROOM_STATUS_CHANGE`).
5. **4:15 – 4:45 | API Docs & Automated Tests**:
   - Open `/api/docs` (Interactive Swagger UI).
   - Run `npm test` in terminal showing all 12 unit & integration tests (including overlapping concurrency conflict & expired hold checks) passing.
