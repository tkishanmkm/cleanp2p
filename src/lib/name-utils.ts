/**
 * Name privacy and display helper utility for P2P trading.
 * 
 * Rules:
 * - FULL: Displays complete legal name in trade chat (e.g. "Adam Dam")
 * - PARTIAL: Displays first initial and last name (e.g. "a. dam" if full name is "adam dam")
 * - HIDE: Does not display name anywhere (counterparty only sees @username)
 * 
 * In all pages (ads, public profiles, cards, lists), ONLY username is displayed.
 * Full/partial names ONLY appear in the Trade Chat 'i' (info) details modal.
 */

export type NameVisibility = 'FULL' | 'PARTIAL' | 'HIDE';

export function formatTradeDisplayName(
  fullName: string | null | undefined,
  visibility: NameVisibility | string | null | undefined
): { formattedName: string | null; isHidden: boolean; type: NameVisibility } {
  const vis = ((visibility || 'FULL') as string).toUpperCase() as NameVisibility;

  if (vis === 'HIDE' || !fullName || !fullName.trim()) {
    return {
      formattedName: null,
      isHidden: true,
      type: 'HIDE',
    };
  }

  const trimmed = fullName.trim();

  if (vis === 'PARTIAL') {
    const parts = trimmed.split(/\s+/);
    if (parts.length === 1) {
      return {
        formattedName: parts[0].toLowerCase(),
        isHidden: false,
        type: 'PARTIAL',
      };
    }
    const initial = parts[0].charAt(0).toLowerCase();
    const lastName = parts[parts.length - 1].toLowerCase();
    return {
      formattedName: `${initial}. ${lastName}`,
      isHidden: false,
      type: 'PARTIAL',
    };
  }

  // FULL name
  return {
    formattedName: trimmed,
    isHidden: false,
    type: 'FULL',
  };
}

/**
 * Returns a live preview string of what the counterparty will see in trade chat 'i' details
 */
export function getTradeNamePreview(
  fullName: string | null | undefined,
  visibility: NameVisibility,
  fallbackExample = 'Adam Dam'
): string {
  const nameToUse = fullName?.trim() || fallbackExample;
  const result = formatTradeDisplayName(nameToUse, visibility);

  if (result.isHidden || !result.formattedName) {
    return 'Hidden (Counterparties will only see your username)';
  }

  return result.formattedName;
}
