# Database Schema & Entity-Relationship Diagram

## Entity-Relationship Diagram

```mermaid
erDiagram
    USERS ||--o{ RESERVATIONS : "books"
    USERS ||--o{ AUDIT_LOGS : "triggers"
    ROOM_TYPES ||--|{ ROOMS : "categorizes"
    ROOM_TYPES ||--o{ RATE_MODIFIERS : "adjusts"
    ROOMS ||--o{ RESERVATIONS : "assigned_to"
    RESERVATIONS ||--o{ PAYMENTS : "settled_by"

    USERS {
        int id PK
        string email UK
        string password_hash
        string full_name
        string phone
        string role "GUEST | STAFF | ADMIN"
        string created_at
    }

    ROOM_TYPES {
        int id PK
        string slug UK
        string name
        string description
        int base_price_cents
        int max_occupancy
        int max_adults
        int max_children
        string bed_type
        int size_sqft
        string amenities_json
        string images_json
        int is_active
        string created_at
    }

    ROOMS {
        int id PK
        string room_number UK
        int floor
        int room_type_id FK
        string status "AVAILABLE | OCCUPIED | CLEANING | MAINTENANCE | OUT_OF_ORDER"
        string notes
        string created_at
    }

    RATE_MODIFIERS {
        int id PK
        int room_type_id FK
        string name
        string modifier_type "WEEKEND | SEASONAL | HOLIDAY"
        float multiplier
        string start_date
        string end_date
        int is_active
    }

    RESERVATIONS {
        int id PK
        string booking_reference UK
        int room_id FK
        int user_id FK
        string guest_name
        string guest_email
        string guest_phone
        string check_in
        string check_out
        int num_adults
        int num_children
        string status "HOLD | CONFIRMED | CHECKED_IN | CHECKED_OUT | CANCELLED | EXPIRED"
        string hold_expires_at
        string special_requests
        string add_ons_json
        int base_price_cents
        int add_ons_price_cents
        int taxes_cents
        int fees_cents
        int total_price_cents
        string idempotency_key UK
        string created_at
        string updated_at
    }

    PAYMENTS {
        int id PK
        int reservation_id FK
        string transaction_reference UK
        int amount_cents
        string currency
        string status "PAID | REFUNDED | FAILED"
        string payment_method
        string card_last_four
        int refund_amount_cents
        string created_at
    }

    AUDIT_LOGS {
        int id PK
        int actor_id FK
        string actor_role
        string actor_email
        string action
        string entity_type
        string entity_id
        string details_json
        string ip_address
        string created_at
    }
```

## Schema Design Highlights & Constraints

1. **Monetary Precision**: All prices, taxes, resort fees, and payment amounts are stored as integer cents (`*_cents`) rather than floating-point numbers to eliminate rounding errors.
2. **Foreign Key Referential Integrity**: `PRAGMA foreign_keys = ON` is enabled globally on all database connections.
3. **Check Constraints**: Enum fields (`role`, `status`, `modifier_type`, `payment.status`) and domain bounds (`base_price_cents > 0`, `floor >= 1`, `max_occupancy > 0`) are strictly enforced at the database engine level.
4. **Concurrency & Performance Indexes**:
   - `idx_reservations_room_dates` on `(room_id, check_in, check_out, status)` optimizes overlap interval scans `(check_in < search_out AND check_out > search_in)`.
   - `idx_reservations_reference` provides O(log n) lookup for booking vouchers and front desk queries.
   - `idx_audit_created` accelerates chronological audit log pagination.
5. **Idempotency**: `idempotency_key` carries a `UNIQUE` index so repeated payment submissions cannot create duplicate reservations or duplicate financial entries.
