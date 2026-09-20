-- ==============================================================================
-- Migration: 20260919020000_add_buyer_marked_paid_enum.sql
-- Purpose: Add 'buyer_marked_paid', 'payment_sent', and other necessary status values to trade_status enum
-- ==============================================================================

DO $$
BEGIN
  BEGIN
    ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'buyer_marked_paid';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'BUYER_MARKED_PAID';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'payment_sent';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'PAYMENT_SENT';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'pending';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'PENDING';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'paid';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'PAID';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'completed';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'COMPLETED';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'released';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'RELEASED';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'disputed';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'DISPUTED';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'cancelled';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'CANCELLED';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;
