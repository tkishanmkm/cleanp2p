console.log("Is SUPABASE_DB_PASSWORD defined?", !!process.env.SUPABASE_DB_PASSWORD);
console.log("Is DATABASE_PASSWORD defined?", !!process.env.DATABASE_PASSWORD);
console.log("Is DB_PASSWORD defined?", !!process.env.DB_PASSWORD);
if (process.env.SUPABASE_DB_PASSWORD) {
  console.log("SUPABASE_DB_PASSWORD length:", process.env.SUPABASE_DB_PASSWORD.length);
}
