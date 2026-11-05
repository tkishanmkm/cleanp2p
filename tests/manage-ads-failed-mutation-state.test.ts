import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = readFileSync(path.join(process.cwd(), 'src/components/ManageAds.tsx'), 'utf8');
const toggleStart = source.indexOf('const toggleStatus = async');
const deleteStart = source.indexOf('const deleteAd = async', toggleStart);
const returnStart = source.indexOf('\n  return (', deleteStart);
assert.ok(toggleStart >= 0 && deleteStart > toggleStart && returnStart > deleteStart, 'mutation handlers should exist');
const toggle = source.slice(toggleStart, deleteStart);
const remove = source.slice(deleteStart, returnStart);

assert.ok(toggle.includes('if (!response.ok)'), 'standalone status request must reject HTTP error responses');
assert.ok(toggle.includes('errorData.error || errorData.message'), 'status failures should surface server error details to logs');
assert.ok(!toggle.slice(0, toggle.indexOf('try {')).includes('setAds('), 'status must not optimistically mutate UI before persistence succeeds');
assert.ok(toggle.includes('setAds(prev => prev.map'), 'standalone status UI update should happen after a successful response');

assert.ok(remove.includes('if (!response.ok)'), 'standalone delete request must reject HTTP error responses');
assert.ok(remove.includes('errorData.error || errorData.message'), 'delete failures should surface server error details to logs');
assert.ok(!remove.slice(0, remove.indexOf('try {')).includes('setAds('), 'delete must not optimistically remove the ad before persistence succeeds');
assert.ok(remove.includes('setAds(prev => prev.filter'), 'standalone delete UI update should happen after a successful response');
console.log('PASS: ManageAds does not optimistically hide failed status/delete mutations and checks HTTP errors');
