import assert from 'node:assert/strict';
import { GET, POST } from '../src/app/api/workers/deposit-listener/route';

async function run() {
  const getResponse = await GET();
  assert.equal(getResponse.status, 410, 'legacy GET must be retired');
  const getBody = await getResponse.json();
  assert.equal(getBody.code, 'DEPOSIT_LISTENER_RETIRED');

  const postResponse = await POST();
  assert.equal(postResponse.status, 410, 'legacy POST must be retired');
  const postBody = await postResponse.json();
  assert.equal(postBody.code, 'DEPOSIT_LISTENER_RETIRED');

  console.log('legacy deposit listener retirement tests passed (4 assertions)');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
