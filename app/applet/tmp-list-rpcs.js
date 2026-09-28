const fs = require('fs');

async function run() {
  const env = JSON.parse(fs.readFileSync('/app/.dev.env.json', 'utf8'));
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;

  console.log('=== LISTING ALL REGISTERED DATABASE RPCS ===');
  const res = await fetch(`${supabaseUrl}/rest/v1/`, {
    headers: { apikey: supabaseKey }
  });
  const openapi = await res.json();
  
  const rpcs = Object.keys(openapi.paths)
    .filter(path => path.startsWith('/rpc/'))
    .map(path => path.slice(5));
    
  console.log('Registered RPC functions:', rpcs);
}

run().catch(console.error);
