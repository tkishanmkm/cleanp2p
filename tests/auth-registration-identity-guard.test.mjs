import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync('src/app/api/auth/validate-registration/route.ts', 'utf8');
const form = readFileSync('src/components/auth/auth-form.tsx', 'utf8');

test('registration identity check verifies hCaptcha server-side and fails closed when configuration is missing', () => {
  assert.match(route, /process\.env\.HCAPTCHA_SECRET_KEY\?\.trim\(\)/);
  assert.match(route, /https:\/\/hcaptcha\.com\/siteverify/);
  assert.match(route, /if \(!hcaptchaSecret\)[\s\S]*?status: 503/);
  assert.match(route, /if \(!captchaVerified\)[\s\S]*?status: 403/);
  assert.match(form, /captchaToken,/);
});

test('unauthenticated registration validation never trusts a supplied userId or mutates another profile', () => {
  assert.doesNotMatch(route, /body\??\.userId|const \{[^}]*userId[^}]*\} = body/);
  assert.doesNotMatch(route, /\.from\('profiles'\)[\s\S]*?\.update\(/);
  assert.doesNotMatch(route, /DUPLICATE_IDENTITY_SUSPENDED|suspension_reason|is_suspended:\s*true/);
});

test('registration identity lookup is narrow, exact-name and DOB scoped, and does not expose matched account data', () => {
  assert.match(route, /\.select\('id'\)[\s\S]*?\.ilike\('full_name', cleanName\)[\s\S]*?\.or\(.*dob\.eq\.[\s\S]*?\.limit\(1\)/);
  assert.match(route, /code: 'IDENTITY_CHECK_FAILED'/);
  assert.doesNotMatch(route, /matched_user_id|attempted_dob|attempted_name|duplicateUser\.id/);
});

test('registration validation rejects malformed dates of birth instead of skipping the age check', () => {
  assert.match(route, /!\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(dob\)/);
  assert.match(route, /birthDate\.toISOString\(\)\.slice\(0, 10\) !== dob/);
});
