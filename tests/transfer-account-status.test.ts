import assert from 'node:assert/strict';
import { isTransferAccountBlocked } from '../src/lib/transfer-account-status';

assert.equal(isTransferAccountBlocked({ account_status: 'ACTIVE' }), false);
assert.equal(isTransferAccountBlocked({ account_status: ' active ' }), false);
assert.equal(isTransferAccountBlocked({ account_status: 'BANNED' }), true);
assert.equal(isTransferAccountBlocked({ account_status: 'DELETION_PENDING' }), true);
assert.equal(isTransferAccountBlocked({ status: 'restricted' }), true);
assert.equal(isTransferAccountBlocked({ is_suspended: true, account_status: 'ACTIVE' }), true);
assert.equal(isTransferAccountBlocked({ is_minor_restricted: true, account_status: 'ACTIVE' }), true);
assert.equal(isTransferAccountBlocked({ is_emergency_frozen: true, account_status: 'ACTIVE' }), true);
assert.equal(isTransferAccountBlocked({ is_restricted: true }), true);
assert.equal(isTransferAccountBlocked({}), false);

console.log('PASS: transfer account status guard handles case normalization and restriction flags');
