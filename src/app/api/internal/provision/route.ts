import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { getOrProvisionHDDepositAddress, STANDARD_DERIVATION_PATHS } from '@/lib/hd-wallet';

// Recognized network and asset identifiers
const VALID_NETWORKS = new Set([
  'BTC',
  'ETH',
  'ERC20',
  'TRC20',
  'TRX',
  'LTC',
  'SOL',
  'POLYGON',
  'ARBITRUM',
  'BSC',
  'XMR',
]);

const VALID_ASSETS = new Set([
  'BTC',
  'ETH',
  'USDT',
  'USDC',
  'TRX',
  'LTC',
  'SOL',
  'XMR',
  'BNB',
  'MATIC',
]);

export async function POST(req: NextRequest) {
  try {
    // 1. Authorization check: Internal service key or valid Bearer session
    const providedSecret =
      req.headers.get('x-provision-secret') ||
      req.headers.get('x-service-key') ||
      req.headers.get('x-api-key');
    const configuredSecret = process.env.CHAIN_INGEST_SECRET || process.env.PROVISION_SERVICE_KEY;
    const authHeader = req.headers.get('authorization');

    let isAuthorized = false;

    if (configuredSecret && providedSecret === configuredSecret) {
      isAuthorized = true;
    } else if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '').trim();
      try {
        const supabaseAdmin = getSupabaseAdminClient();
        const { data: userData, error: authError } = await supabaseAdmin.auth.getUser(token);
        if (!authError && userData?.user) {
          isAuthorized = true;
        }
      } catch {
        isAuthorized = false;
      }
    } else if (process.env.NODE_ENV === 'development' || !configuredSecret) {
      // In local dev without configured secrets, allow standard internal calls
      isAuthorized = true;
    }

    if (!isAuthorized) {
      return NextResponse.json(
        { error: 'Unauthorized: Missing or invalid authorization session token or service key.' },
        { status: 401 }
      );
    }

    // 2. Parse request payload
    const body = await req.json().catch(() => ({}));
    const userId = body?.userId || body?.user_id;
    const crypto = (body?.crypto || body?.asset || body?.asset_code || body?.cryptoCode || '')
      .toString()
      .trim()
      .toUpperCase();
    const network = (body?.network || body?.network_code || body?.networkCode || '')
      .toString()
      .trim()
      .toUpperCase();

    // 3. Handle single direct provisioning request
    if (userId) {
      // Validate asset and network
      if (!crypto) {
        return NextResponse.json(
          { error: 'Bad Request: Missing required parameter "crypto".' },
          { status: 400 }
        );
      }

      if (!network) {
        return NextResponse.json(
          { error: 'Bad Request: Missing required parameter "network".' },
          { status: 400 }
        );
      }

      if (
        !VALID_NETWORKS.has(network) &&
        !VALID_NETWORKS.has(crypto) &&
        !STANDARD_DERIVATION_PATHS[network] &&
        !STANDARD_DERIVATION_PATHS[crypto]
      ) {
        return NextResponse.json(
          {
            error: `Bad Request: Unsupported network "${network}" or crypto "${crypto}". Supported networks: ${Array.from(
              VALID_NETWORKS
            ).join(', ')}`,
          },
          { status: 400 }
        );
      }

      // Provision or retrieve HD deposit address
      try {
        const result = await getOrProvisionHDDepositAddress(userId, crypto, network);

        return NextResponse.json({
          success: true,
          address: result.address,
          path: result.path,
          crypto,
          network,
          isNew: result.isNew,
        });
      } catch (provisionErr: unknown) {
        const message = provisionErr instanceof Error ? provisionErr.message : String(provisionErr);
        return NextResponse.json(
          { error: `HD Wallet Provisioning Error: ${message}` },
          { status: 500 }
        );
      }
    }

    // 4. Fallback: Process queued provisioning jobs if batch execution requested
    const limit = Math.min(Math.max(Number(body?.limit) || 10, 1), 100);
    const supabaseAdmin = getSupabaseAdminClient();

    const { data: queuedJobs, error: fetchError } = await supabaseAdmin
      .from('wallet_provisioning')
      .select('id, user_id, wallet_id, asset_code, network_code, retry_count')
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(limit);

    if (fetchError) {
      return NextResponse.json(
        { error: `Database error fetching provisioning jobs: ${fetchError.message}` },
        { status: 500 }
      );
    }

    if (!queuedJobs || queuedJobs.length === 0) {
      return NextResponse.json({
        success: true,
        processedCount: 0,
        message: 'No queued provisioning jobs found.',
      });
    }

    let processedCount = 0;
    for (const job of queuedJobs) {
      try {
        await supabaseAdmin
          .from('wallet_provisioning')
          .update({ status: 'processing', updated_at: new Date().toISOString() })
          .eq('id', job.id);

        const result = await getOrProvisionHDDepositAddress(
          job.user_id,
          job.asset_code,
          job.network_code
        );

        await supabaseAdmin
          .from('wallet_provisioning')
          .update({ status: 'completed', updated_at: new Date().toISOString() })
          .eq('id', job.id);

        processedCount++;
      } catch (jobErr: unknown) {
        const errorMsg = jobErr instanceof Error ? jobErr.message : String(jobErr);
        await supabaseAdmin
          .from('wallet_provisioning')
          .update({
            status: 'failed',
            retry_count: (job.retry_count || 0) + 1,
            error_message: errorMsg,
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.id);
      }
    }

    return NextResponse.json({
      success: true,
      processedCount,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown server error.';
    return NextResponse.json(
      { error: `Internal Server Error: ${message}` },
      { status: 500 }
    );
  }
}

