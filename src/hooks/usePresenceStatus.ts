'use client';

import { usePresenceStatus } from '@/lib/presence';

export {
  usePresenceStatus,
  getPresenceStatus,
  resolveUserLastSeen,
  formatJoinedDate,
} from '@/lib/presence';

export default usePresenceStatus;
