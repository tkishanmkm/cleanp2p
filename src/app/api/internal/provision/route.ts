import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { getOrProvisionHDDepositAddress, SUPPORTED_ASSET_NETWORKS } from '@/lib/hd-wallet';

// Asset/network compatibility is centrally enforced by the HD wallet module.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  try {
    // 1. Authorization check: Internal service key or valid Bearer session
    const authHeader = req.headers.get('authorization') || '';
    const bearerMatch = /^Bearer\s+(.+)$/i.exec(authHeader);
    const providedSecret =
      req.headers.get('x-provision-secret') ||
      req.headers.get('x-service-key') ||
      req.headers.get('x-api-key') ||
      bearerMatch?.[1]?.trim() ||
      null;
    const configuredSecret =
      process.env.WALLET_PROVISIONING_SECRET ||
      process.env.CHAIN_INGEST_SECRET ||
      process.env.PROVISION_SERVICE_KEY ||
      '';

    const expectedSecretBytes = Buffer.from(configuredSecret.trim(), 'utf8');
    const providedSecretBytes = Buffer.from((providedSecret || '').trim(), 'utf8');
    const hasValidServiceSecret =
      expectedSecretBytes.length > 0 &&
      expectedSecretBytes.length === providedSecretBytes.length &&
      timingSafeEqual(expectedSecretBytes, providedSecretBytes);

    let isAuthorized = false;
    let authenticatedUserId: string | null = null;

    if (hasValidServiceSecret) {
      isAuthorized = true;
    } else if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice('Bearer '.length).trim();
      try {
        const supabaseAdmin = getSupabaseAdminClient();
        const { data: userData, error: authError } = await supabaseAdmin.auth.getUser(token);
        if (!authError && userData?.user?.id) {
          authenticatedUserId = userData.user.id;
          isAuthorized = true;
        }
      } catch {
        isAuthorized = false;
      }
    } else if (process.env.NODE_ENV === 'development' && !configuredSecret) {
      // Local development only. Production requests must present a service key
      // or a valid user session that is bound to its own userId below.
      isAuthorized = true;
    }

    if (!isAuthorized) {
      return NextResponse.json(
        { error: 'Unauthorized: Missing or invalid authorization session token or service key.' },
        { status: 401 }
      );
    }

    // 2. Reject oversized requests while streaming; Content-Length is optional.
    const declaredContentLength = Number(req.headers.get('content-length') || 0);
    if (Number.isFinite(declaredContentLength) && declaredContentLength > 2048) {
      return NextResponse.json(
        { success: false, code: 'REQUEST_TOO_LARGE', error: 'Provisioning request body exceeds 2 KB.' },
        { status: 413 }
      );
    }

    const bodyReader = req.body?.getReader();
    if (!bodyReader) {
      return NextResponse.json(
        { success: false, code: 'INVALID_REQUEST_BODY', error: 'A JSON object body is required.' },
        { status: 400 }
      );
    }

    const bodyChunks: Uint8Array[] = [];
    let bodyByteLength = 0;
    try {
      while (true) {
        const { done, value } = await bodyReader.read();
        if (done) break;
        bodyByteLength += value.byteLength;
        if (bodyByteLength > 2048) {
          await bodyReader.cancel().catch(() => undefined);
          return NextResponse.json(
            { success: false, code: 'REQUEST_TOO_LARGE', error: 'Provisioning request body exceeds 2 KB.' },
            { status: 413 }
          );
        }
        bodyChunks.push(value);
      }
    } catch {
      return NextResponse.json(
        { success: false, code: 'INVALID_REQUEST_BODY', error: 'Could not read the provisioning request body.' },
        { status: 400 }
      );
    }

    const bodyBytes = new Uint8Array(bodyByteLength);
    let bodyOffset = 0;
    for (const chunk of bodyChunks) {
      bodyBytes.set(chunk, bodyOffset);
      bodyOffset += chunk.byteLength;
    }

    let body: Record<string, unknown>;
    try {
      const rawBody = new TextDecoder('utf-8', { fatal: true }).decode(bodyBytes);
      const parsedBody: unknown = JSON.parse(rawBody);
      if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
        throw new Error('A JSON object is required.');
      }
      body = parsedBody as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { success: false, code: 'INVALID_REQUEST_BODY', error: 'A valid JSON object is required.' },
        { status: 400 }
      );
    }

    const rawUserId = body.userId ?? body.user_id;
    const userId = typeof rawUserId === 'string' ? rawUserId.trim() : null;
    if (rawUserId != null && (!userId || !UUID_PATTERN.test(userId))) {
      return NextResponse.json(
        { success: false, code: 'INVALID_USER_ID', error: 'userId must be a valid UUID.' },
        { status: 400 }
      );
    }

    // A user session may provision only that same user's address. Queue/batch
    // processing is service-only; a normal authenticated account is not a worker.
    if (authenticatedUserId && (!userId || String(userId) !== authenticatedUserId)) {
      return NextResponse.json(
        { error: 'Forbidden: user sessions may provision addresses only for their own account.' },
        { status: 403 }
      );
    }

    const rawAsset = body.crypto ?? body.asset ?? body.asset_code ?? body.cryptoCode;
    const rawNetwork = body.network ?? body.network_code ?? body.networkCode;
    const crypto = typeof rawAsset === 'string' ? rawAsset.trim().toUpperCase() : '';
    const network = typeof rawNetwork === 'string' ? rawNetwork.trim().toUpperCase() : '';

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

      const allowedNetworks = SUPPORTED_ASSET_NETWORKS[crypto];
      if (!allowedNetworks || !allowedNetworks.has(network)) {
        return NextResponse.json(
          {
            success: false,
            code: 'UNSUPPORTED_ASSET_NETWORK_PAIR',
            error: `Unsupported asset/network pair: ${crypto}/${network}.`,
            supportedNetworks: allowedNetworks ? Array.from(allowedNetworks) : [],
            supportedAssets: Object.keys(SUPPORTED_ASSET_NETWORKS),
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
      .select('id, user_id, asset_code, network_code, retry_count')
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(limit);

    if (fetchError) {
      const missingQueueTable =
        fetchError.code === '42P01' ||
        fetchError.code === 'PGRST205' ||
        (/wallet_provisioning/i.test(fetchError.message) &&
          /(does not exist|not found|schema cache)/i.test(fetchError.message));

      if (missingQueueTable) {
        return NextResponse.json(
          {
            success: false,
            code: 'WALLET_PROVISIONING_QUEUE_UNAVAILABLE',
            error: 'The wallet provisioning queue is not installed in this database. Direct user provisioning remains available.',
          },
          { status: 503 }
        );
      }

      return NextResponse.json(
        {
          success: false,
          code: 'WALLET_PROVISIONING_QUEUE_READ_FAILED',
          error: `Database error fetching provisioning jobs: ${fetchError.message}`,
        },
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
        // Claim with a compare-and-set update. Two concurrent batch requests may
        // read the same queued row, but only one can move it to processing.
        const { data: claimedJob, error: claimError } = await supabaseAdmin
          .from('wallet_provisioning')
          .update({
            status: 'processing',
            error_message: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.id)
          .eq('status', 'queued')
          .select('id')
          .maybeSingle();

        if (claimError) {
          console.error(`[Wallet Provisioning] Could not claim queue job ${job.id}:`, claimError.message);
          continue;
        }
        if (!claimedJob) {
          // Another worker won the atomic claim, or the row is no longer queued.
          continue;
        }

        await getOrProvisionHDDepositAddress(
          job.user_id,
          job.asset_code,
          job.network_code
        );

        const { data: completedJob, error: completionError } = await supabaseAdmin
          .from('wallet_provisioning')
          .update({
            status: 'completed',
            error_message: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.id)
          .eq('status', 'processing')
          .select('id')
          .maybeSingle();

        if (completionError || !completedJob) {
          throw new Error(
            `Provisioning succeeded but queue completion was not persisted: ${completionError?.message || 'job is no longer processing'}`
          );
        }

        processedCount++;
      } catch (jobErr: unknown) {
        const errorMsg = (jobErr instanceof Error ? jobErr.message : String(jobErr)).slice(0, 1000);
        const { error: failureUpdateError } = await supabaseAdmin
          .from('wallet_provisioning')
          .update({
            status: 'failed',
            retry_count: (Number(job.retry_count) || 0) + 1,
            error_message: errorMsg,
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.id)
          .eq('status', 'processing');

        if (failureUpdateError) {
          console.error(
            `[Wallet Provisioning] Could not persist failure for queue job ${job.id}:`,
            failureUpdateError.message
          );
        }
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

