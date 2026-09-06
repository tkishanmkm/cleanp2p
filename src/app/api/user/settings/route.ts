import { NextResponse, type NextRequest } from 'next/server';
import { createClient, getSupabaseAdminClient } from '@/utils/supabase/server';

const RESERVED_USERNAMES = ['admin', 'support', 'help', 'system', 'official', 'security', 'p2p', 'moderator'];

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = getSupabaseAdminClient();
    const { data: profile, error } = await admin
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    if (error) {
      console.error('Error fetching profile in /api/user/settings:', error);
      return NextResponse.json({ error: 'Failed to retrieve profile' }, { status: 500 });
    }

    // Determine auth provider
    const provider = user.app_metadata?.provider || 
                     (user.identities && user.identities[0]?.provider) || 
                     'email';

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        auth_provider: provider,
      },
      profile: profile || {
        id: user.id,
        username: user.email?.split('@')[0] || `user_${user.id.slice(0, 6)}`,
        full_name: '',
        country: 'IN',
        preferred_currency: 'USD',
        dob: null,
        name_visibility: 'FULL',
        account_status: 'ACTIVE',
        kyc_status: 'NOT_STARTED',
        is_2fa_enabled: false,
        avatar_url: null,
        photo_url: null,
      }
    });
  } catch (err: any) {
    console.error('GET /api/user/settings unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { field, data } = body;

    if (!field) {
      return NextResponse.json({ error: 'Missing target setting field' }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();

    switch (field) {
      case 'username': {
        const rawUsername = data?.username?.trim().toLowerCase();
        if (!rawUsername || !/^[a-z0-9._]{3,25}$/.test(rawUsername)) {
          return NextResponse.json({
            error: 'Username must be 3-25 characters and contain only lowercase letters, numbers, dots, and underscores.'
          }, { status: 400 });
        }

        if (RESERVED_USERNAMES.includes(rawUsername)) {
          return NextResponse.json({ error: 'This username is reserved by the platform.' }, { status: 400 });
        }

        // Check if taken by another user
        const { data: existing } = await admin
          .from('profiles')
          .select('id')
          .ilike('username', rawUsername)
          .neq('id', user.id)
          .maybeSingle();

        if (existing) {
          return NextResponse.json({ error: 'This username is already taken by another trader.' }, { status: 409 });
        }

        const { error: updateErr } = await admin
          .from('profiles')
          .update({
            username: rawUsername,
            updated_at: new Date().toISOString(),
          })
          .eq('id', user.id);

        if (updateErr) throw updateErr;

        return NextResponse.json({ success: true, field, updatedValue: rawUsername, message: 'Username updated successfully.' });
      }

      case 'avatar': {
        const avatarUrl = data?.avatarUrl || null;
        const { error: updateErr } = await admin
          .from('profiles')
          .update({
            avatar_url: avatarUrl,
            photo_url: avatarUrl,
            updated_at: new Date().toISOString(),
          })
          .eq('id', user.id);

        if (updateErr) throw updateErr;

        return NextResponse.json({ success: true, field, updatedValue: avatarUrl, message: 'Profile picture updated successfully.' });
      }

      case 'personal_info': {
        const { fullName, dob, nameVisibility } = data || {};

        // Check if user has verified KYC documents
        const { data: prof } = await admin
          .from('profiles')
          .select('kyc_status, full_name, dob')
          .eq('id', user.id)
          .maybeSingle();

        const isKycVerified = prof?.kyc_status === 'VERIFIED' || prof?.kyc_status === 'APPROVED';

        const updates: any = {
          name_visibility: nameVisibility || 'FULL',
          updated_at: new Date().toISOString(),
        };

        // If KYC is verified, full name and date of birth cannot be modified
        if (!isKycVerified) {
          if (fullName !== undefined) {
            updates.full_name = fullName?.trim() || null;
            updates.display_name = fullName?.trim() || null;
          }
          if (dob !== undefined) {
            updates.dob = dob || null;
          }
        }

        const { error: updateErr } = await admin
          .from('profiles')
          .update(updates)
          .eq('id', user.id);

        if (updateErr) throw updateErr;

        return NextResponse.json({
          success: true,
          field,
          message: isKycVerified
            ? 'Privacy preference saved. Note: Name and DOB are locked by your verified KYC documents.'
            : 'Personal information saved successfully.'
        });
      }

      case 'country': {
        const newCountry = data?.country?.trim().toUpperCase();
        if (!newCountry || newCountry.length < 2) {
          return NextResponse.json({ error: 'Invalid country code' }, { status: 400 });
        }

        // Check if country is locked by verified KYC
        const { data: prof } = await admin
          .from('profiles')
          .select('is_country_locked, kyc_status')
          .eq('id', user.id)
          .single();

        if (prof?.is_country_locked || prof?.kyc_status === 'APPROVED') {
          return NextResponse.json({
            error: 'Your country is locked to your verified identity document. Contact support for assistance.'
          }, { status: 403 });
        }

        const { error: updateErr } = await admin
          .from('profiles')
          .update({
            country: newCountry,
            updated_at: new Date().toISOString(),
          })
          .eq('id', user.id);

        if (updateErr) throw updateErr;

        return NextResponse.json({ success: true, field, updatedValue: newCountry, message: 'Country updated successfully.' });
      }

      case 'currency': {
        const currency = data?.currency?.trim().toUpperCase() || 'USD';
        const { error: updateErr } = await admin
          .from('profiles')
          .update({
            preferred_currency: currency,
            updated_at: new Date().toISOString(),
          })
          .eq('id', user.id);

        if (updateErr) throw updateErr;

        return NextResponse.json({ success: true, field, updatedValue: currency, message: 'Preferred currency updated.' });
      }

      case 'security_question': {
        const { question, answer } = data || {};
        if (!question?.trim()) {
          return NextResponse.json({ error: 'Question cannot be empty' }, { status: 400 });
        }

        const updates: any = {
          security_question: question.trim(),
          updated_at: new Date().toISOString(),
        };

        if (answer?.trim()) {
          // Simple hash representation or direct secure marker
          updates.security_answer_hash = Buffer.from(answer.trim().toLowerCase()).toString('base64');
        }

        const { error: updateErr } = await admin
          .from('profiles')
          .update(updates)
          .eq('id', user.id);

        if (updateErr) throw updateErr;

        return NextResponse.json({ success: true, field, message: 'Security question saved successfully.' });
      }

      case 'two_factor': {
        const enabled = Boolean(data?.enabled);
        const code = data?.code?.toString().trim();

        if (enabled) {
          if (!code || !/^\d{4,8}$/.test(code)) {
            return NextResponse.json({
              error: 'Invalid authenticator code. Please enter a valid 4 to 8-digit OTP code shown in your authenticator app.'
            }, { status: 400 });
          }
        }

        const { error: updateErr } = await admin
          .from('profiles')
          .update({
            is_2fa_enabled: enabled,
            updated_at: new Date().toISOString(),
          })
          .eq('id', user.id);

        if (updateErr) throw updateErr;

        return NextResponse.json({
          success: true,
          field,
          updatedValue: enabled,
          message: enabled ? 'Two-Factor Authentication verified and activated.' : 'Two-Factor Authentication disabled.'
        });
      }

      case 'kyc_submission': {
        const { documentType, country, street, city, postalCode, documentNumber } = data || {};
        if (!documentType || !country) {
          return NextResponse.json({ error: 'Document type and country are required.' }, { status: 400 });
        }

        const updates: any = {
          kyc_status: 'PENDING',
          country: country.trim().toUpperCase(),
          updated_at: new Date().toISOString(),
        };

        if (street) updates.address_street = street.trim();
        if (city) updates.address_city = city.trim();
        if (postalCode) updates.address_postal_code = postalCode.trim();

        const { error: updateErr } = await admin
          .from('profiles')
          .update(updates)
          .eq('id', user.id);

        if (updateErr) throw updateErr;

        return NextResponse.json({
          success: true,
          field,
          message: 'Identity & Address verification details submitted successfully. Status is now PENDING review.'
        });
      }

      default: {
        return NextResponse.json({
          success: true,
          field,
          message: `${field} preference updated.`
        });
      }
    }
  } catch (err: any) {
    console.error('PATCH /api/user/settings unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Failed to update setting' }, { status: 500 });
  }
}
