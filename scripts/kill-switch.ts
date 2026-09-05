import 'dotenv/config';
import { getSupabaseAdminClient } from '../src/lib/supabase/server';

async function toggleKillSwitch(enableHalt: boolean) {
  const supabase = getSupabaseAdminClient();

  const { data, error } = await supabase
    .from('platform_settings')
    .update({
      global_kill_switch_active: enableHalt,
      withdrawals_enabled: !enableHalt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1)
    .select()
    .single();

  if (error) {
    console.error('❌ Failed to update platform settings:', error.message);
    process.exit(1);
  }

  if (data.global_kill_switch_active) {
    console.log('🚨 EMERGENCY HALT ACTIVATED: All withdrawals are now BLOCKED globally (HTTP 503).');
  } else {
    console.log('✅ SYSTEM RESUMED: Withdrawals are now ACTIVE.');
  }
}

// Command parsing
const command = process.argv[2];

if (command === 'halt') {
  toggleKillSwitch(true);
} else if (command === 'resume') {
  toggleKillSwitch(false);
} else {
  console.log('Usage: npx ts-node scripts/kill-switch.ts [halt|resume]');
  process.exit(1);
}
