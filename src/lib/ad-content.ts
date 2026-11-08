import { resolveBothTargetRows } from '@/lib/ad-lookup';

export interface AtomicAdContentActor {
  id: string;
  email?: string | null;
  isAdmin?: boolean;
}

export type AtomicAdContentPatch = Record<string, unknown>;

export type AtomicAdContentResult =
  | {
      ok: true;
      ownerId: string;
      canonicalUpdated: boolean;
      legacyUpdated: boolean;
      auditLogged: boolean;
      data: Record<string, unknown>;
    }
  | {
      ok: false;
      statusCode: number;
      code: string;
      error: string;
    };

/**
 * Applies allowlisted advertisement content changes in one database transaction.
 * The RPC independently rechecks service-role execution, actor identity,
 * ownership/full-admin authority, paired-row identity, account status and SELL
 * inventory restrictions. No status or inventory field is part of this patch.
 */
export async function updateAdContentAtomically(
  adminClient: any,
  existingAd: any,
  rawAdId: string,
  actor: AtomicAdContentActor,
  patch: AtomicAdContentPatch,
): Promise<AtomicAdContentResult> {
  const targets = await resolveBothTargetRows(existingAd, rawAdId, adminClient);

  if (targets.lookupErrors.p2p_ads || targets.lookupErrors.ads) {
    return {
      ok: false,
      statusCode: 503,
      code: 'AD_MIRROR_LOOKUP_FAILED',
      error: 'Advertisement records could not be checked safely. No edit was attempted.',
    };
  }

  if (targets.ownerMismatches.p2p_ads || targets.ownerMismatches.ads) {
    return {
      ok: false,
      statusCode: 409,
      code: 'AD_IDENTIFIER_OWNER_MISMATCH',
      error: 'The advertisement identifier did not resolve to one consistent owner. No edit was attempted.',
    };
  }

  if (!targets.p2pAdsRow && !targets.adsRow) {
    return {
      ok: false,
      statusCode: 404,
      code: 'AD_NOT_FOUND',
      error: 'Advertisement not found.',
    };
  }

  if (!actor.id || !targets.ownerId) {
    return {
      ok: false,
      statusCode: 409,
      code: 'AD_OWNER_UNRESOLVED',
      error: 'Advertisement owner could not be verified. No edit was attempted.',
    };
  }

  const isOwner = String(actor.id) === String(targets.ownerId);
  if (!isOwner && actor.isAdmin !== true) {
    return {
      ok: false,
      statusCode: 403,
      code: 'AD_CONTENT_FORBIDDEN',
      error: 'Only the advertisement owner or an active full administrator may edit this listing.',
    };
  }

  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).length === 0) {
    return {
      ok: false,
      statusCode: 400,
      code: 'EMPTY_AD_CONTENT_PATCH',
      error: 'No editable advertisement fields were supplied.',
    };
  }

  const { data, error } = await adminClient.rpc('update_ad_content_atomic_authorized', {
    p_actor_id: actor.id,
    p_actor_email: actor.email || null,
    p_p2p_ad_id: targets.p2pAdsRow?.id || null,
    p_legacy_ad_id: targets.adsRow?.id || null,
    p_patch: patch,
  });

  if (error || !data || data.success !== true) {
    const databaseCode = String(error?.code || '');
    const databaseMessage = String(error?.message || '');
    const isTerminalDeleted = databaseCode === '23514' && databaseMessage.toLowerCase().includes('deleted');
    const normalizedDatabaseMessage = databaseMessage.toLowerCase();
    const isSellGuard = databaseCode === '23514' &&
      (normalizedDatabaseMessage.includes('sell') || normalizedDatabaseMessage.includes('only buy'));
    const isPairMismatch = databaseCode === '22023' &&
      (databaseMessage.toLowerCase().includes('same logical') ||
       databaseMessage.toLowerCase().includes('directions do not match'));
    const code = isTerminalDeleted
      ? 'AD_DELETED_TERMINAL'
      : isSellGuard
        ? 'SELL_AD_INVENTORY_RESERVATION_UNVERIFIED'
        : isPairMismatch
          ? 'AD_MIRROR_IDENTITY_MISMATCH'
          : databaseCode === '42501'
            ? 'AD_CONTENT_FORBIDDEN'
            : databaseCode === 'P0002'
              ? 'AD_NOT_FOUND'
              : databaseCode === '22023'
                ? 'INVALID_AD_CONTENT'
                : databaseCode === 'PGRST202' || databaseCode === '42883'
                  ? 'ATOMIC_AD_CONTENT_RPC_NOT_INSTALLED'
                  : 'ATOMIC_AD_CONTENT_UPDATE_FAILED';
    const statusCode = databaseCode === '42501'
      ? 403
      : databaseCode === 'P0002'
        ? 404
        : databaseCode === '23514' || isPairMismatch
          ? 409
          : databaseCode === '22023'
            ? 400
            : 503;
    const message = code === 'AD_DELETED_TERMINAL'
      ? 'A deleted advertisement cannot be edited.'
      : code === 'SELL_AD_INVENTORY_RESERVATION_UNVERIFIED'
        ? 'SELL advertisements cannot be edited until atomic crypto inventory reservation is enabled.'
        : code === 'AD_MIRROR_IDENTITY_MISMATCH'
          ? 'The canonical and legacy advertisement records failed their identity consistency check.'
          : code === 'AD_CONTENT_FORBIDDEN'
            ? 'The advertisement owner or an active full administrator is required.'
            : code === 'AD_NOT_FOUND'
              ? 'The advertisement record was not found.'
              : code === 'INVALID_AD_CONTENT'
                ? 'The advertisement update was rejected because one or more values are invalid.'
                : code === 'ATOMIC_AD_CONTENT_RPC_NOT_INSTALLED'
                  ? 'The approved atomic advertisement content migration must be applied before edits are enabled.'
                  : 'Advertisement content and its legacy mirror could not be updated atomically.';

    return { ok: false, statusCode, code, error: message };
  }

  const canonicalUpdated = targets.p2pAdsRow !== null;
  const legacyUpdated = targets.adsRow !== null;
  const ownerId = String(data.owner_id || '');

  if (
    ownerId !== String(targets.ownerId) ||
    data.canonical_updated !== canonicalUpdated ||
    data.legacy_updated !== legacyUpdated ||
    (actor.isAdmin === true && data.audit_logged !== true)
  ) {
    return {
      ok: false,
      statusCode: 503,
      code: 'ATOMIC_AD_CONTENT_RESPONSE_MISMATCH',
      error: 'The atomic advertisement edit returned an incomplete or inconsistent result.',
    };
  }

  return {
    ok: true,
    ownerId,
    canonicalUpdated,
    legacyUpdated,
    auditLogged: data.audit_logged === true,
    data: data as Record<string, unknown>,
  };
}
