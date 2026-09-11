# Engineering Principles & Architecture Guidelines

## 1. Database & PostgreSQL (Supabase)
- **Strict Data Typing:** Never mix `uuid` and `text` types in joins, comparisons, or RLS policies. Always use explicit type casts (e.g. `col::uuid` or `col::text`) to prevent operator mismatch errors (PostgreSQL Error 42883).
- **Row Level Security (RLS):** Every table must have RLS enabled with explicit policies for `SELECT`, `INSERT`, `UPDATE`, and `DELETE`. Ensure `auth.uid()` comparisons match the column's data type.
- **Foreign Keys & Referential Integrity:** Maintain referential integrity across related tables (`trades`, `profiles`, `messages`, `wallets`, `transfers`) with appropriate `ON DELETE CASCADE` or `SET NULL` actions.

## 2. Backend & API Services
- **Defensive Error Handling:** Return raw, clear error structures with error codes and descriptions while safeguarding secrets.
- **Input Validation:** Enforce schema validation (Zod, TypeScript interfaces) and verify authentication and role permissions before executing transactions.
- **Decoupled Architecture:** Keep business logic cleanly organized in dedicated library modules and service helpers rather than coupling tightly to raw route handlers.

## 3. Frontend & Client Integration
- **Async State Management:** Gracefully handle loading indicators, empty states, network retries, and error boundaries.
- **Client Schema Validation:** Ensure data payloads strictly match backend types prior to sending requests to Supabase or internal API endpoints.

## 4. Code Output & Craftsmanship
- Provide clean, production-grade, defensive TypeScript and SQL code.
- Add explanatory notes for critical type conversions, concurrency safety, and transaction atomicity.
