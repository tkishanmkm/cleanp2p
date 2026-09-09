import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/utils/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      vendor_session_id,
      status,
      user_id,
      client_reference_id,
      decision,
      extracted_data,
      user_data,
      features,
    } = body;

    // Didit can pass target user ID in user_id, client_reference_id, or nested objects
    const targetUserId = user_id || client_reference_id || user_data?.user_id;

    // Check Didit status / decision
    const isApproved =
      status === 'approved' ||
      status === 'completed' ||
      decision === 'approved' ||
      body.verification_status === 'approved';

    let kycStatus = 'PENDING';
    if (isApproved) kycStatus = 'APPROVED';
    else if (status === 'rejected' || decision === 'declined') kycStatus = 'REJECTED';
    else if (status === 'expired') kycStatus = 'EXPIRED';

    if (targetUserId) {
      const supabaseAdmin = getSupabaseAdminClient();

      const updatePayload: Record<string, any> = {
        kyc_status: kycStatus,
        kyc_vendor_session_id: vendor_session_id || body.session_id || null,
        updated_at: new Date().toISOString(),
      };

      // Extract verified full name and DOB from Didit payload
      // Didit features/extracted_data can have first_name, last_name, full_name, date_of_birth, dob
      const idData =
        extracted_data?.id ||
        extracted_data ||
        features?.ocr ||
        body.ocr_data ||
        user_data ||
        {};

      const extractedFirstName = idData.first_name || idData.firstName || '';
      const extractedLastName = idData.last_name || idData.lastName || '';
      const extractedFullName =
        idData.full_name ||
        idData.fullName ||
        idData.formatted_name ||
        (extractedFirstName || extractedLastName
          ? `${extractedFirstName} ${extractedLastName}`.trim()
          : null);

      const extractedDob =
        idData.date_of_birth ||
        idData.dob ||
        idData.birth_date ||
        idData.dateOfBirth ||
        null;

      const extractedCountry =
        idData.issuing_country ||
        idData.nationality ||
        idData.country ||
        null;

      if (isApproved) {
        // Auto-set and permanently lock user's full name, dob, and country from official KYC document
        if (extractedFullName) {
          updatePayload.full_name = extractedFullName;
        }
        if (extractedDob) {
          updatePayload.dob = extractedDob;
          updatePayload.date_of_birth = extractedDob;
        }
        if (extractedCountry) {
          updatePayload.country = extractedCountry.toUpperCase().slice(0, 2);
          updatePayload.is_country_locked = true;
        }
        updatePayload.is_kyc_locked = true;
        updatePayload.id_verified = true;
      }

      const { error: updateErr } = await supabaseAdmin
        .from('profiles')
        .update(updatePayload)
        .eq('id', targetUserId);

      if (updateErr) {
        console.error('Error updating profile with KYC data:', updateErr);
      }
    }

    return NextResponse.json({ received: true, kyc_status: kycStatus });
  } catch (err: any) {
    console.error('Error handling KYC webhook:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

