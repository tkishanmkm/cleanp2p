import { resolveBothTargetRows } from '@/lib/ad-lookup';

export type AtomicAdStatus =
  | 'ACTIVE'
  | 'INACTIVE'
  | 'PAUSED'
  | 'HIDDEN'
  | 'DRAFT'
  | 'DELETED';

export interface AtomicAdStatusActor {
  id: string;
  email?: string | null;
  isAdmin?: boolean;
}

export type AtomicAdStatusResult =
  | {
      ok: true;
      status: AtomicAdStatus;
      ownerId: string;
      canonicalUpdated: boolean;
      legacyUpdated: boolean;
      auditLogged: boolean;
    }
  | {
      ok: false;
      statusCode: number;
      code: string;
      error: string;
    };

/**
 * Changes the canonical listing and any legacy mirror through one database
 * transaction. The RPC is service-role-only and independently rechecks the
 * authenticated actor, ownership, paired-row identity and activation rules.
 */
export async function setAdStatusAtomically(
  adminClient: any,
  existingAd: any,
  rawAdId: string,
  actor: AtomicAdStatusActor,
  status: AtomicAdStatus
): Promise<AtomicAdStatusResult> {
  const targets = await resolveBothTargetRows(existingAd, rawAdId, adminClient);

  if (targets.lookupErrors.p2p_ads || targets.lookupErrors.ads) {
    return {
      ok: false,
      statusCode: 503,
      code: 'AD_MIRROR_LOOKUP_FAILED',
      error: 'Advertisement records could not be checked safely. No status update was attempted.',
    };
  }

  if (targets.ownerMismatches.p2p_ads || targets.ownerMismatches.ads) {
    return {
      ok: false,
      statusCode: 409,
      code: 'AD_IDENTIFIER_OWNER_MISMATCH',
      error: 'The advertisement identifier did not resolve to one consistent owner. No status update was attempted.',
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

  const expectedOwnerId = targets.ownerId || null;
  const { data, error } = await adminClient.rpc('set_ad_status_atomic_authorized', {
    p_actor_id: actor.id,
    p_actor_email: actor.email || null,
    p_p2p_ad_id: targets.p2pAdsRow?.id || null,
    p_legacy_ad_id: targets.adsRow?.id || null,
    p_status: status,
  });

  if (error || !data || data.success !== true) {
    const databaseCode = String(error?.code || '');
    const databaseMessage = String(error?.message || '');
    const isTerminalDeletedAd = databaseCode === '23514' && databaseMessage.includes('Deleted advertisements cannot be reactivated or changed');
    const code = isTerminalDeletedAd ? 'AD_DELETED_TERMINAL'
      : databaseCode === '23514' ? 'SELL_AD_INVENTORY_RESERVATION_UNVERIFIED'
      : databaseCode === '22023' ? 'AD_MIRROR_IDENTITY_MISMATCH'
      : databaseCode === '42501' ? 'AD_STATUS_FORBIDDEN'
      : databaseCode === 'P0002' ? 'AD_NOT_FOUND'
      : databaseCode === 'PGRST202' || databaseCode === '42883' ? 'ATOMIC_AD_STATUS_RPC_NOT_INSTALLED'
      : 'ATOMIC_AD_STATUS_UPDATE_FAILED';
    const statusCode = databaseCode === '42501' ? 403
      : databaseCode === 'P0002' ? 404
      : databaseCode === '23514' || databaseCode === '22023' ? 409
      : 503;
    const message = code === 'AD_DELETED_TERMINAL'
      ? 'A deleted advertisement cannot be reactivated or changed.'
      : code === 'SELL_AD_INVENTORY_RESERVATION_UNVERIFIED'
      ? 'SELL advertisements cannot be activated until their crypto inventory is reserved atomically.'
      : code === 'AD_MIRROR_IDENTITY_MISMATCH'
      ? 'The canonical and legacy advertisement records failed their identity consistency check.'
      : code === 'AD_STATUS_FORBIDDEN'
      ? 'The advertisement owner or an active full administrator is required.'
      : code === 'AD_NOT_FOUND'
      ? 'The advertisement record was not found.'
      : code === 'ATOMIC_AD_STATUS_RPC_NOT_INSTALLED'
      ? 'The approved atomic advertisement status migration must be applied before this operation is available.'
      : 'Advertisement status and its legacy mirror could not be updated atomically.';
    return { ok: false, statusCode, code, error: message };
  }

  const canonicalUpdated = targets.p2pAdsRow !== null;
  const legacyUpdated = targets.adsRow !== null;
  const ownerId = String(data.owner_id || '');

  if (
    data.status !== status ||
    !ownerId ||
    (expectedOwnerId && ownerId !== String(expectedOwnerId)) ||
    data.canonical_updated !== canonicalUpdated ||
    data.legacy_updated !== legacyUpdated ||
    (actor.isAdmin === true && ownerId !== actor.id && data.audit_logged !== true)
  ) {
    return {
      ok: false,
      statusCode: 503,
      code: 'ATOMIC_AD_STATUS_RESPONSE_MISMATCH',
      error: 'The atomic advertisement status update returned an incomplete or inconsistent result.',
    };
  }

  return {
    ok: true,
    status,
    ownerId,
    canonicalUpdated,
    legacyUpdated,
    auditLogged: data.audit_logged === true,
  };
}
