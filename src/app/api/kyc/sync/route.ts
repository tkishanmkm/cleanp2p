import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

function isApprovedText(val: any): boolean {
  if (!val) return false;
  const s = String(val).toLowerCase();
  return s === 'approved' || s === 'passed' || s === 'completed' || s === 'true' || s === 'verified';
}

export async function GET(req: NextRequest) {
  return handleSync(req);
}

export async function POST(req: NextRequest) {
  return handleSync(req);
}

async function handleSync(req: NextRequest) {
  try {
    const admin = getSupabaseAdminClient();
    const supabase = await createServerClient();

    let targetUserId: string | null = null;

    // Check auth session
    const authHeader = req.headers.get('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace(/^Bearer\s+/i, '').trim();
      const { data } = await admin.auth.getUser(token);
      if (data?.user?.id) targetUserId = data.user.id;
    }

    if (!targetUserId) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.id) targetUserId = user.id;
    }

    // Allow query or body fallback for admin / background sync
    const url = new URL(req.url);
    const queryUserId = url.searchParams.get('userId') || url.searchParams.get('id');
    const queryEmail = url.searchParams.get('email');
    if (!targetUserId && queryUserId) {
      targetUserId = queryUserId;
    }

    let targetEmail = queryEmail;

    if (!targetUserId && !targetEmail) {
      try {
        const body = await req.json().catch(() => ({}));
        if (body.userId) targetUserId = body.userId;
        if (body.email) targetEmail = body.email;
      } catch {
        // ignore
      }
    }

    if (!targetUserId && !targetEmail) {
      return NextResponse.json({ error: 'Unauthorized: User ID or email required' }, { status: 401 });
    }

    // Fetch user profile by ID or email
    let profileQuery = admin.from('profiles').select('*');
    if (targetUserId) {
      profileQuery = profileQuery.eq('id', targetUserId);
    } else if (targetEmail) {
      profileQuery = profileQuery.eq('email', targetEmail);
    }

    const { data: profile, error: profErr } = await profileQuery.maybeSingle();

    if (profErr || !profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    targetUserId = profile.id;

    const currentStatus = (profile.kyc_status || 'NOT_STARTED').toLowerCase();

    // If already verified/approved, ensure all flags are set and return
    if (currentStatus === 'approved' || currentStatus === 'verified' || profile.is_verified || profile.id_verified) {
      if (!profile.id_verified || !profile.is_verified || !profile.is_kyc_locked) {
        await admin.from('profiles').update({
          kyc_status: 'approved',
          id_verified: true,
          is_verified: true,
          is_kyc_locked: true,
          is_country_locked: Boolean(profile.country),
          updated_at: new Date().toISOString(),
        }).eq('id', targetUserId);
      }

      return NextResponse.json({
        success: true,
        is_verified: true,
        id_verified: true,
        kyc_status: 'approved',
        status: 'approved',
        profile: {
          ...profile,
          kyc_status: 'approved',
          id_verified: true,
          is_verified: true,
          is_kyc_locked: true,
        },
      });
    }

    // Check 24-hour timeout for stuck "in_review" / "pending"
    const isUnderReview = ['in_review', 'pending', 'pending_review', 'submitted', 'under_review'].includes(currentStatus);
    const submittedAt = profile.kyc_submitted_at || profile.kyc_last_attempt_at || profile.updated_at;
    const hoursSinceSubmission = submittedAt ? (Date.now() - new Date(submittedAt).getTime()) / (1000 * 60 * 60) : 0;

    const apiKey = process.env.DIDIT_API_KEY;
    const rawBaseUrl = process.env.DIDIT_API_URL || 'https://verification.didit.me/v3';
    const diditBase = rawBaseUrl.replace(/\/+$/, '');
    const sessionId = profile.didit_session_id || profile.kyc_vendor_session_id;

    // If we have API key and session ID, query verification provider
    let diditResult: any = null;
    if (apiKey && sessionId) {
      try {
        // 1. Try decision endpoint
        const decisionRes = await fetch(`${diditBase}/session/${sessionId}/decision/`, {
          headers: {
            'x-api-key': apiKey,
            'Accept': 'application/json',
          },
          cache: 'no-store',
        });

        if (decisionRes.ok) {
          diditResult = await decisionRes.json();
        } else {
          // 2. Try session endpoint
          const sessionRes = await fetch(`${diditBase}/session/${sessionId}/`, {
            headers: {
              'x-api-key': apiKey,
              'Accept': 'application/json',
            },
            cache: 'no-store',
          });
          if (sessionRes.ok) {
            diditResult = await sessionRes.json();
          }
        }
      } catch (apiErr) {
        console.warn('KYC sync provider fetch warning:', apiErr);
      }
    }

    // Process provider decision
    if (diditResult) {
      const decisionObj = diditResult.decision || diditResult;
      const statusStr = String(decisionObj.status || diditResult.status || '').toLowerCase();
      const idVerifications = decisionObj.id_verifications || diditResult.id_verifications || [];
      const primaryId = Array.isArray(idVerifications) && idVerifications.length > 0 ? idVerifications[0] : null;

      const isApproved = statusStr === 'approved' || statusStr === 'passed' || (primaryId && isApprovedText(primaryId.status));
      const isDeclined = statusStr === 'declined' || statusStr === 'rejected' || statusStr === 'failed';

      if (isApproved) {
        // Extract KYC data
        const extractedFirstName = primaryId?.first_name || decisionObj.first_name || '';
        const extractedLastName = primaryId?.last_name || decisionObj.last_name || '';
        const extractedFullName = (primaryId?.full_name || `${extractedFirstName} ${extractedLastName}` || profile.full_name || '').trim();
        const extractedDob = primaryId?.date_of_birth || primaryId?.dob || decisionObj.date_of_birth || profile.dob || profile.date_of_birth;
        const extractedCountry = primaryId?.issuing_country || primaryId?.country || decisionObj.country || profile.country;
        const documentNumber = primaryId?.document_number || primaryId?.id_number || decisionObj.document_number;

        let extractedAddress = primaryId?.address || primaryId?.formatted_address || decisionObj.address || decisionObj.formatted_address;
        if (typeof extractedAddress === 'object' && extractedAddress !== null) {
          extractedAddress = [
            extractedAddress.street_line_1 || extractedAddress.street,
            extractedAddress.city,
            extractedAddress.state || extractedAddress.province,
            extractedAddress.postal_code || extractedAddress.zip_code,
            extractedAddress.country,
          ].filter(Boolean).join(', ');
        }

        const updatePayload: Record<string, any> = {
          kyc_status: 'approved',
          is_verified: true,
          id_verified: true,
          is_kyc_locked: true,
          kyc_approved_at: new Date().toISOString(),
          kyc_retry_count: 0,
          kyc_attempts: 0,
          updated_at: new Date().toISOString(),
        };

        if (extractedFullName) {
          updatePayload.full_name = extractedFullName;
        }
        if (extractedDob) {
          updatePayload.dob = extractedDob;
          updatePayload.date_of_birth = extractedDob;
        }
        if (extractedCountry) {
          updatePayload.country = String(extractedCountry).toUpperCase().slice(0, 2);
          updatePayload.is_country_locked = true;
        }
        if (documentNumber) {
          updatePayload.id_document_number = documentNumber;
        }
        if (extractedAddress && typeof extractedAddress === 'string' && extractedAddress.trim()) {
          updatePayload.address = extractedAddress.trim();
          updatePayload.address_street = extractedAddress.trim();
          updatePayload.is_address_locked = true;
        }

        await admin.from('profiles').update(updatePayload).eq('id', targetUserId);

        if (sessionId) {
          await admin.from('kyc_verifications').update({
            status: 'APPROVED',
            decision: diditResult,
            updated_at: new Date().toISOString(),
          }).eq('session_id', sessionId);
        }

        return NextResponse.json({
          success: true,
          is_verified: true,
          id_verified: true,
          kyc_status: 'approved',
          status: 'approved',
          profile: {
            ...profile,
            ...updatePayload,
          },
        });
      } else if (isDeclined) {
        const attempts = (profile.kyc_retry_count || profile.kyc_attempts || 0) + 1;
        const newStatus = attempts >= 3 ? 'permanently_rejected' : 'declined';

        await admin.from('profiles').update({
          kyc_status: newStatus,
          kyc_retry_count: attempts,
          kyc_attempts: attempts,
          updated_at: new Date().toISOString(),
        }).eq('id', targetUserId);

        return NextResponse.json({
          success: true,
          is_verified: false,
          id_verified: false,
          kyc_status: newStatus,
          status: newStatus,
          attempts,
        });
      }
    }

    // If 24 hours have passed without decision and it is in_review, clear review status to allow restart
    if (isUnderReview && hoursSinceSubmission >= 24) {
      await admin.from('profiles').update({
        kyc_status: 'not_started',
        didit_session_id: null,
        kyc_vendor_session_id: null,
        updated_at: new Date().toISOString(),
      }).eq('id', targetUserId);

      return NextResponse.json({
        success: true,
        is_verified: false,
        id_verified: false,
        kyc_status: 'not_started',
        status: 'not_started',
        message: 'Review period expired after 24 hours. Verification form reset.',
      });
    }

    return NextResponse.json({
      success: true,
      is_verified: false,
      id_verified: false,
      kyc_status: profile.kyc_status || 'NOT_STARTED',
      status: profile.kyc_status || 'NOT_STARTED',
      hoursSinceSubmission: Math.round(hoursSinceSubmission * 10) / 10,
    });
  } catch (err: any) {
    console.error('KYC sync error:', err);
    return NextResponse.json({ error: err.message || 'Failed to sync KYC status' }, { status: 500 });
  }
}
