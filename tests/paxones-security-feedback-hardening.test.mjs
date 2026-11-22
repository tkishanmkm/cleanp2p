import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const marketplaceMigration = read('supabase/migrations/20261105300000_harden_marketplace_rls_and_dml.sql');
const sellInterlockMigration = read('supabase/migrations/20261105310000_enforce_sell_ad_escrow_interlock.sql');
const feedbackMigration = read('supabase/migrations/20261105330000_harden_remaining_financial_and_feedback_policies.sql');
const p2pAds = read('src/app/api/p2p/ads/route.ts');
const newFeedbackApi = read('src/app/api/trades/[tradeId]/feedback/route.ts');
const legacyFeedbackApi = read('src/app/api/trade/feedback/route.ts');
const profile = read('src/app/profile/page.tsx');
const tradeDetails = read('src/components/trade/trade-details.tsx');
const tradeDisputeApi = read('src/app/api/trades/[tradeId]/dispute/route.ts');
const adminHelpers = read('src/lib/admin.ts');
const withdrawalsPage = read('src/app/adminnarayan/withdrawals/page.tsx');
const moderatorPage = read('src/app/adminnarayan/trades/[tradeId]/page.tsx');

test('SELL ads fail closed before the atomic BUY-ad RPC and never write marketplace rows directly', () => {
  const guard = p2pAds.indexOf("code: 'SELL_AD_INVENTORY_RESERVATION_UNVERIFIED'");
  const createBuyAd = p2pAds.indexOf("rpc('create_buy_ad_atomic'");
  assert.ok(guard >= 0);
  assert.ok(createBuyAd > guard, 'SELL guard must precede the canonical BUY-only creation RPC');
  assert.doesNotMatch(p2pAds, /\.from\(['"](?:ads|p2p_ads)['"]\)\s*\.(?:insert|update|upsert|delete)/);
  assert.match(p2pAds, /if \(adSide !== 'BUY'\)[\s\S]{0,450}status: 503/);
});

test('new feedback endpoint uses deployed feedbacks schema, not missing trade_feedback', () => {
  assert.match(newFeedbackApi, /\.from\('feedbacks'\)/);
  assert.doesNotMatch(newFeedbackApi, /\.from\('trade_feedback'\)/);
  assert.match(newFeedbackApi, /typeof isPositive !== 'boolean'/);
  assert.match(newFeedbackApi, /comment\.trim\(\)\.length === 0/);
  assert.match(newFeedbackApi, /\.eq\('trade_id', tradeId\)\s*\.eq\('reviewer_id', reviewerId\)/);
});

test('legacy feedback API is a compatibility adapter over canonical feedbacks and derives the recipient server-side', () => {
  assert.match(legacyFeedbackApi, /\.from\('feedbacks'\)/);
  assert.doesNotMatch(legacyFeedbackApi, /\.from\('feedback'\)/);
  assert.match(legacyFeedbackApi, /const expectedCounterpartId = user\.id === buyerId \? sellerId : buyerId/);
  assert.match(legacyFeedbackApi, /counterpartId !== expectedCounterpartId/);
  assert.match(legacyFeedbackApi, /reviewer_id: user\.id/);
  assert.match(legacyFeedbackApi, /reviewee_id: expectedCounterpartId/);
  assert.match(legacyFeedbackApi, /You have already submitted feedback for this trade/);
});

test('profile history merges canonical and legacy production feedback stores', () => {
  assert.match(profile, /\.from\('feedbacks'\)/);
  assert.match(profile, /feedbacks_reviewer_id_fkey/);
  assert.match(profile, /feedbacks_reviewee_id_fkey/);
  assert.match(profile, /\.from\('feedback'\)/);
  assert.match(profile, /feedback_from_user_fkey/);
  assert.match(profile, /feedback_to_user_fkey/);
  assert.match(profile, /reviewer_id: row\.from_user/);
  assert.match(profile, /reviewee_id: row\.to_user/);
  assert.doesNotMatch(profile, /\.from\('trade_feedback'\)/);
});

test('feedback UI uses the authenticated compatibility API and never reads or writes feedback tables directly', () => {
  assert.match(tradeDetails, /fetch\(['"]\/api\/trade\/feedback['"]/);
  assert.match(tradeDetails, /apiData\?\.success !== true/);
  assert.doesNotMatch(tradeDetails, /\.from\(['"]feedbacks?['"]\)/);
  assert.doesNotMatch(tradeDetails, /\/api\/trade\/feedback\?[^'"]*userId=/);
});

test('participant dispute creation uses the verified server route, not browser table DML', () => {
  assert.match(tradeDetails, /fetch\(\x60\/api\/trades\/\$\{encodeURIComponent\(trade\.id\)\}\/dispute\x60/);
  assert.doesNotMatch(tradeDetails, /\.from\(['"]disputes['"]\)\s*\.insert/);
  assert.match(tradeDisputeApi, /rpc\('raise_trade_dispute'/);
  assert.match(tradeDisputeApi, /trade\.buyer_id !== user\.id && trade\.seller_id !== user\.id/);
  assert.match(feedbackMigration, /REVOKE INSERT, UPDATE, DELETE[\s\S]+?ON TABLE public\.disputes[\s\S]+?FROM PUBLIC, anon, authenticated/);
});

test('revoked deposit table writes have no remaining legacy browser helpers', () => {
  assert.doesNotMatch(adminHelpers, /\.from\(['"]deposits['"]\)\s*\.update/);
  assert.doesNotMatch(adminHelpers, /function (approveDeposit|declineDeposit|approveWithdrawal|declineWithdrawal)\s*\(/);
  assert.doesNotMatch(withdrawalsPage, /approveWithdrawal|declineWithdrawal/);
  assert.match(feedbackMigration, /public\.deposits[\s\S]+?FROM PUBLIC, anon, authenticated/);
});

test('moderator chat reads and writes go through the verified server API only', () => {
  assert.match(moderatorPage, /\/api\/admin\/trades\//);
  assert.doesNotMatch(moderatorPage, /\.from\(["']trade_chat_messages["']\)/);
  assert.doesNotMatch(moderatorPage, /\.from\(["']trades["']\)/);
  assert.doesNotMatch(moderatorPage, /supabase\.from\(["']trade_chat_messages["']\)\.insert/);
});

test('forward migrations remove direct financial writes and preserve safe marketplace reads', () => {
  assert.match(marketplaceMigration, /ads_public_active_read/);
  assert.match(marketplaceMigration, /p2p_ads_public_active_read/);
  assert.match(marketplaceMigration, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER[\s\S]+?public\.ads, public\.p2p_ads[\s\S]+?FROM PUBLIC, anon, authenticated/);
  assert.match(marketplaceMigration, /GRANT SELECT ON TABLE public\.ads, public\.p2p_ads/);
  assert.match(sellInterlockMigration, /SELL_AD_INVENTORY_RESERVATION_UNVERIFIED/);
  assert.match(sellInterlockMigration, /IF v_ad_type IS DISTINCT FROM ''BUY''/);
});

test('feedback INSERT is limited to a completed counterparty review; UPDATE and DELETE stay denied', () => {
  assert.match(feedbackMigration, /REVOKE INSERT, UPDATE, DELETE[\s\S]+?ON TABLE public\.feedback\s+FROM PUBLIC, anon, authenticated/);
  assert.match(feedbackMigration, /DROP CONSTRAINT IF EXISTS feedbacks_trade_id_key/);
  assert.match(feedbackMigration, /ADD CONSTRAINT feedbacks_trade_reviewer_unique UNIQUE \(trade_id, reviewer_id\)/);
  assert.match(feedbackMigration, /feedbacks_insert_completed_trade_counterparty/);
  assert.match(feedbackMigration, /t\.buyer_id::text = \(SELECT auth\.uid\(\)\)::text/);
  assert.match(feedbackMigration, /t\.seller_id::text = \(SELECT auth\.uid\(\)\)::text/);
  assert.match(feedbackMigration, /GRANT INSERT ON TABLE public\.feedbacks TO authenticated/);
  assert.match(feedbackMigration, /REVOKE UPDATE, DELETE[\s\S]+?public\.feedbacks[\s\S]+?FROM PUBLIC, anon, authenticated/);
  assert.match(feedbackMigration, /REVOKE ALL PRIVILEGES[\s\S]+?public\.user_feedbacks[\s\S]+?FROM PUBLIC, anon, authenticated/);
  assert.match(feedbackMigration, /recalculate_feedback_reputation\(\)/);
  assert.match(feedbackMigration, /FROM public\.profiles AS p[\s\S]+?FOR UPDATE/);
  assert.match(feedbackMigration, /TG_OP = 'DELETE'/);
  assert.match(feedbackMigration, /CREATE TRIGGER feedbacks_recalculate_reputation_after_insert/);
  assert.match(feedbackMigration, /CREATE TRIGGER feedbacks_recalculate_reputation_after_delete/);
  assert.doesNotMatch(feedbackMigration, /GRANT (UPDATE|DELETE|ALL)[^;]*public\.feedbacks/i);
});
