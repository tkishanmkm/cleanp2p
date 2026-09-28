const fs = require('fs');
const { Client } = require('pg');

async function run() {
  const envPath = '/app/applet/.env.local';
  console.log('Reading env from absolute path:', envPath);
  const content = fs.readFileSync(envPath, 'utf8');
  const env = {};
  content.split('\n').forEach(line => {
    const parts = line.split('=');
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const val = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
      env[key] = val;
    }
  });

  const dbUrl = env.POSTGRES_DB_URL || env.DATABASE_URL;
  if (!dbUrl) {
    console.error('No database URL found!');
    return;
  }

  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();
  const res = await client.query("SELECT prosrc FROM pg_proc WHERE proname = 'process_deposit_atomic';");
  if (res.rows.length > 0) {
    console.log('=== Definition of process_deposit_atomic ===');
    console.log(res.rows[0].prosrc);
  } else {
    console.log('Function process_deposit_atomic not found!');
  }
  await client.end();
}

run().catch(console.error);
