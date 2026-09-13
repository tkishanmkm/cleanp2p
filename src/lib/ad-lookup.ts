import { getSupabaseAdminClient } from '@/lib/supabase/server';

export interface ResolvedAdResult {
  ad: any;
  tableName: 'ads' | 'p2p_ads' | 'offers' | string;
}

export function isValidUUID(str: any): boolean {
  if (!str || typeof str !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str.trim());
}

/**
 * Robust, resilient ad resolver that safely finds an active or existing ad by any identifier:
 * - UUID id
 * - text / cuid / nanoid id (e.g. 'niedw51wpbah')
 * - public_ad_id (e.g. 'AD-ABC12345')
 * - ad_id (e.g. 'ADABC1234567')
 * - public_id
 * - offer_id
 * 
 * Safely tries queries across both `ads` and `p2p_ads` tables with individual try-catch blocks
 * to prevent PostgreSQL 22P02 (UUID syntax) or PGRST100 / PGRST204 (column missing) errors.
 */
export async function findAdById(rawId: string): Promise<ResolvedAdResult | null> {
  if (!rawId || typeof rawId !== 'string') return null;

  const cleanId = rawId.replace(/^#/, '').trim();
  if (!cleanId) return null;

  const adminClient = getSupabaseAdminClient();
  const isUuid = isValidUUID(cleanId);
  const upperId = cleanId.toUpperCase();
  const lowerId = cleanId.toLowerCase();

  const candidateTables = ['ads', 'p2p_ads', 'offers'];

  // 1. If UUID, check primary id column on all candidate tables
  if (isUuid) {
    for (const table of candidateTables) {
      try {
        const { data, error } = await adminClient
          .from(table)
          .select('*')
          .eq('id', cleanId)
          .maybeSingle();
        if (data && !error) {
          return { ad: data, tableName: table };
        }
      } catch {}
    }
  }

  // 2. If not UUID (or if UUID failed), try text matching on `id` column with safe error catch
  if (!isUuid) {
    for (const table of candidateTables) {
      try {
        const { data, error } = await adminClient
          .from(table)
          .select('*')
          .eq('id', cleanId)
          .maybeSingle();
        if (data && !error) {
          return { ad: data, tableName: table };
        }
      } catch {}

      // Also try lowercase / uppercase if distinct
      if (lowerId !== cleanId) {
        try {
          const { data, error } = await adminClient
            .from(table)
            .select('*')
            .eq('id', lowerId)
            .maybeSingle();
          if (data && !error) {
            return { ad: data, tableName: table };
          }
        } catch {}
      }
    }
  }

  // 3. Search public_ad_id column
  for (const table of candidateTables) {
    try {
      const { data, error } = await adminClient
        .from(table)
        .select('*')
        .eq('public_ad_id', cleanId)
        .maybeSingle();
      if (data && !error) return { ad: data, tableName: table };
    } catch {}

    try {
      const { data, error } = await adminClient
        .from(table)
        .select('*')
        .eq('public_ad_id', upperId)
        .maybeSingle();
      if (data && !error) return { ad: data, tableName: table };
    } catch {}

    try {
      const { data, error } = await adminClient
        .from(table)
        .select('*')
        .ilike('public_ad_id', cleanId)
        .maybeSingle();
      if (data && !error) return { ad: data, tableName: table };
    } catch {}
  }

  // 4. Search ad_id column
  for (const table of candidateTables) {
    try {
      const { data, error } = await adminClient
        .from(table)
        .select('*')
        .eq('ad_id', cleanId)
        .maybeSingle();
      if (data && !error) return { ad: data, tableName: table };
    } catch {}

    try {
      const { data, error } = await adminClient
        .from(table)
        .select('*')
        .eq('ad_id', upperId)
        .maybeSingle();
      if (data && !error) return { ad: data, tableName: table };
    } catch {}

    try {
      const { data, error } = await adminClient
        .from(table)
        .select('*')
        .ilike('ad_id', cleanId)
        .maybeSingle();
      if (data && !error) return { ad: data, tableName: table };
    } catch {}
  }

  // 5. Search public_id column
  for (const table of candidateTables) {
    try {
      const { data, error } = await adminClient
        .from(table)
        .select('*')
        .eq('public_id', cleanId)
        .maybeSingle();
      if (data && !error) return { ad: data, tableName: table };
    } catch {}

    try {
      const { data, error } = await adminClient
        .from(table)
        .select('*')
        .eq('public_id', upperId)
        .maybeSingle();
      if (data && !error) return { ad: data, tableName: table };
    } catch {}
  }

  // 6. Search offer_id column
  for (const table of candidateTables) {
    try {
      const { data, error } = await adminClient
        .from(table)
        .select('*')
        .eq('offer_id', cleanId)
        .maybeSingle();
      if (data && !error) return { ad: data, tableName: table };
    } catch {}
  }

  // 7. Broad fallback: Fetch all active / recent ads and check in-memory match across any ID field
  for (const table of candidateTables) {
    try {
      const { data } = await adminClient
        .from(table)
        .select('*')
        .limit(100);

      if (data && Array.isArray(data)) {
        const found = data.find((row: any) => {
          const rowId = String(row.id || '').trim();
          const rowAdId = String(row.ad_id || '').trim();
          const rowPublicAdId = String(row.public_ad_id || '').trim();
          const rowPublicId = String(row.public_id || '').trim();
          const rowOfferId = String(row.offer_id || '').trim();

          return (
            rowId === cleanId ||
            rowAdId === cleanId ||
            rowPublicAdId === cleanId ||
            rowPublicId === cleanId ||
            rowOfferId === cleanId ||
            rowId.toLowerCase() === lowerId ||
            rowAdId.toLowerCase() === lowerId ||
            rowPublicAdId.toLowerCase() === lowerId ||
            rowPublicId.toLowerCase() === lowerId ||
            rowOfferId.toLowerCase() === lowerId
          );
        });

        if (found) {
          return { ad: found, tableName: table };
        }
      }
    } catch {}
  }

  return null;
}
