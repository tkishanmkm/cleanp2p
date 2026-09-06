/* eslint-disable @next/next/no-img-element */
'use client';

import React, { useState, useEffect, useRef, ChangeEvent, FormEvent, useMemo } from 'react';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/components/providers/auth-provider';
import {
  User,
  ShieldCheck,
  Lock,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Upload,
  Trash2,
  Check,
  X,
  ArrowLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Copy,
  Mail,
  Laptop,
  Ban,
  Clock,
  Info,
  Search,
  Key,
  Smartphone,
  HelpCircle,
} from 'lucide-react';
import {
  ALL_COUNTRIES,
  ALL_CURRENCIES,
  ALL_UTC_TIMEZONES,
  CountryItem,
  CurrencyItem,
  UtcTimezoneItem,
} from '@/lib/settings-constants';

// =========================================================================
// TYPES & LIST DEFINITIONS
// =========================================================================
export type CategoryKey = 'all' | 'profile' | 'preferences' | 'security' | 'identity';
export type SecuritySubCategory = 'none' | 'password' | '2fa' | 'questions' | 'blocked' | 'sessions';

interface CategoryListItem {
  key: Exclude<CategoryKey, 'all'>;
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  badgeText?: string;
}

const CATEGORIES_LIST: CategoryListItem[] = [
  {
    key: 'profile',
    title: 'Profile',
    subtitle: 'Profile picture, username handle, and personal information',
    icon: User,
    badgeText: 'Avatar & Details',
  },
  {
    key: 'preferences',
    title: 'Preferences',
    subtitle: 'Trading preferences, default fiat currency, language, timezone, & alerts',
    icon: Sliders,
    badgeText: 'Trading & Alerts',
  },
  {
    key: 'security',
    title: 'Security',
    subtitle: 'Password, 2FA authenticator, security questions, blocked users, & sessions',
    icon: Lock,
    badgeText: 'Account Protection',
  },
  {
    key: 'identity',
    title: 'Identity Verification',
    subtitle: 'Tier 1 ($1,000 USD limit) vs Tier 2 (No Limit) & permanent document KYC',
    icon: ShieldCheck,
    badgeText: 'KYC & Limits',
  },
];

const LANGUAGES = [
  { code: 'en', name: 'English (US)' },
  { code: 'es', name: 'Español (Spanish)' },
  { code: 'hi', name: 'हिन्दी (Hindi)' },
  { code: 'ar', name: 'العربية (Arabic)' },
  { code: 'fr', name: 'Français (French)' },
  { code: 'de', name: 'Deutsch (German)' },
  { code: 'zh', name: '中文 (Chinese)' },
  { code: 'pt', name: 'Português (Portuguese)' },
  { code: 'ru', name: 'Русский (Russian)' },
];

const KYC_DOC_TYPES = [
  { id: 'PASSPORT', label: 'Passport' },
  { id: 'NATIONAL_ID', label: 'National ID Card' },
  { id: 'DRIVERS_LICENSE', label: "Driver's License" },
  { id: 'RESIDENCE_PERMIT', label: 'Residence Permit' },
  { id: 'GOVERNMENT_ID', label: 'Government-Issued Photo ID' },
];

const SECURITY_QUESTIONS = [
  'What was the name of your first pet?',
  'What city or town were you born in?',
  "What is your mother's maiden name?",
  'What was the make and model of your first vehicle?',
  'What was the name of your elementary school?',
  'What was the name of your childhood best friend?',
];

export default function SettingsPage() {
  const supabase = createClient();
  const { refreshProfile } = useAuth();

  // Navigation State: 'all' = simple list of categories; clicking one opens that category
  const [activeCategory, setActiveCategory] = useState<CategoryKey>('all');

  // Loading & Session State
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [profile, setProfile] = useState<any>(null);

  // Status & Feedback Toast
  const [toastMsg, setToastMsg] = useState<{ id: number; type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [savingField, setSavingField] = useState<string | null>(null);

  // ----------------------------------------------------
  // 1. PROFILE STATE
  // ----------------------------------------------------
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const [username, setUsername] = useState('');
  const [isCheckingUsername, setIsCheckingUsername] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [usernameReason, setUsernameReason] = useState('');
  const [usernameTimer, setUsernameTimer] = useState<NodeJS.Timeout | null>(null);

  const [fullName, setFullName] = useState('');
  const [dob, setDob] = useState('');
  const [nameVisibility, setNameVisibility] = useState<'FULL' | 'PARTIAL' | 'HIDE'>('FULL');

  // ----------------------------------------------------
  // 2. IDENTITY VERIFICATION STATE
  // ----------------------------------------------------
  const frontDocInputRef = useRef<HTMLInputElement>(null);
  const backDocInputRef = useRef<HTMLInputElement>(null);
  const [kycCountry, setKycCountry] = useState('IN');
  const [isCountryModalOpen, setIsCountryModalOpen] = useState(false);
  const [countrySearchQuery, setCountrySearchQuery] = useState('');

  const [kycDocType, setKycDocType] = useState('PASSPORT');
  const [kycDocNumber, setKycDocNumber] = useState('');
  const [kycStreet, setKycStreet] = useState('');
  const [kycCity, setKycCity] = useState('');
  const [kycPostalCode, setKycPostalCode] = useState('');
  const [frontDocFile, setFrontDocFile] = useState<File | null>(null);
  const [frontDocName, setFrontDocName] = useState('');
  const [frontDocPreview, setFrontDocPreview] = useState<string | null>(null);
  const [backDocFile, setBackDocFile] = useState<File | null>(null);
  const [backDocName, setBackDocName] = useState('');
  const [backDocPreview, setBackDocPreview] = useState<string | null>(null);

  const [isKycSubmitted, setIsKycSubmitted] = useState(false);
  const [kycStatus, setKycStatus] = useState<'NOT_SUBMITTED' | 'PENDING' | 'VERIFIED' | 'REJECTED'>('NOT_SUBMITTED');
  const [submittingKyc, setSubmittingKyc] = useState(false);

  // ----------------------------------------------------
  // 3. PREFERENCES STATE
  // ----------------------------------------------------
  const [currency, setCurrency] = useState('USD');
  const [isCurrencyModalOpen, setIsCurrencyModalOpen] = useState(false);
  const [currencySearchQuery, setCurrencySearchQuery] = useState('');

  const [language, setLanguage] = useState('en');
  const [timezone, setTimezone] = useState('UTC±00:00');
  const [isTimezoneModalOpen, setIsTimezoneModalOpen] = useState(false);
  const [timezoneSearchQuery, setTimezoneSearchQuery] = useState('');

  const [autoReplyMessage, setAutoReplyMessage] = useState('');
  const [notifications, setNotifications] = useState({
    email_trade_requests: true,
    email_escrow_deposit: true,
    email_payment_sent: true,
    email_release_confirmation: true,
    chat_messages: true,
    sound_alerts: true,
    marketing_updates: false,
  });

  // ----------------------------------------------------
  // 4. SECURITY STATE (Clean sub-sub categories)
  // ----------------------------------------------------
  const [activeSecSub, setActiveSecSub] = useState<SecuritySubCategory>('none');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [is2faEnabled, setIs2faEnabled] = useState(false);
  const [twoFaOtpCode, setTwoFaOtpCode] = useState('');
  const [verifying2fa, setVerifying2fa] = useState(false);

  const [secQuestion, setSecQuestion] = useState(SECURITY_QUESTIONS[0]);
  const [secAnswer, setSecAnswer] = useState('');
  const [blockedUsers, setBlockedUsers] = useState<any[]>([]);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);
  const [sessions] = useState<any[]>([
    {
      id: 'current-session',
      device: 'Current Device / Web Browser',
      ip: '127.0.0.1 (Current Session)',
      lastActive: 'Active now',
      isCurrent: true,
    },
  ]);

  // Is KYC locked (verified or submitted permanent document)
  const isKycLocked = isKycSubmitted || kycStatus === 'VERIFIED' || kycStatus === 'PENDING';

  // Filtered lists for search selectors
  const filteredCountries = useMemo(() => {
    const q = countrySearchQuery.trim().toLowerCase();
    if (!q) return ALL_COUNTRIES;
    return ALL_COUNTRIES.filter(
      (c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)
    );
  }, [countrySearchQuery]);

  const filteredCurrencies = useMemo(() => {
    const q = currencySearchQuery.trim().toLowerCase();
    if (!q) return ALL_CURRENCIES;
    return ALL_CURRENCIES.filter(
      (c) =>
        c.code.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.symbol.toLowerCase().includes(q)
    );
  }, [currencySearchQuery]);

  const filteredTimezones = useMemo(() => {
    const q = timezoneSearchQuery.trim().toLowerCase();
    if (!q) return ALL_UTC_TIMEZONES;
    return ALL_UTC_TIMEZONES.filter(
      (t) =>
        t.offset.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.cities.toLowerCase().includes(q)
    );
  }, [timezoneSearchQuery]);

  // Toast Helper
  const notify = (type: 'success' | 'error' | 'info', text: string) => {
    setToastMsg({ id: Date.now(), type, text });
    setTimeout(() => {
      setToastMsg((prev) => (prev?.text === text ? null : prev));
    }, 4500);
  };

  // Broadcast updates across entire application
  const broadcastProfileUpdate = async (updatedData: Record<string, any>) => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('profile-updated', { detail: updatedData }));
    }
    try {
      await supabase.auth.updateUser({ data: updatedData });
    } catch (e) {
      console.warn('Metadata update error:', e);
    }
    try {
      await refreshProfile();
    } catch (e) {
      console.warn('Profile refresh error:', e);
    }
  };

  // Load Settings on Mount
  useEffect(() => {
    loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadSettings() {
    try {
      setLoading(true);
      const res = await fetch('/api/user/settings');
      if (res.ok) {
        const data = await res.json();
        const p = data.profile || {};
        const u = data.user || {};

        setUserId(u.id || p.id || '');
        setUserEmail(u.email || p.email || '');
        setProfile(p);

        // Profile details
        setAvatarUrl(p.avatar_url || p.photo_url || null);
        setUsername(p.username || '');
        setFullName(p.full_name || '');
        setDob(p.dob || p.date_of_birth || '');
        setNameVisibility(p.name_visibility || 'FULL');

        // KYC status
        const kStatus = p.kyc_status || 'NOT_SUBMITTED';
        setKycStatus(kStatus);
        if (kStatus === 'PENDING' || kStatus === 'VERIFIED') {
          setIsKycSubmitted(true);
        }
        if (p.country) setKycCountry(p.country);
        if (p.address_street) setKycStreet(p.address_street);
        if (p.address_city) setKycCity(p.address_city);
        if (p.address_postal_code) setKycPostalCode(p.address_postal_code);

        // Preferences
        setCurrency(p.preferred_currency || 'USD');
        setIs2faEnabled(Boolean(p.is_2fa_enabled));
        if (p.security_question) setSecQuestion(p.security_question);

        // Read local storage preferences
        if (typeof window !== 'undefined' && u.id) {
          try {
            const stored = localStorage.getItem(`p2p_preferences_${u.id}`);
            if (stored) {
              const pref = JSON.parse(stored);
              if (pref.language) setLanguage(pref.language);
              if (pref.timezone) setTimezone(pref.timezone);
              if (pref.autoReplyMessage) setAutoReplyMessage(pref.autoReplyMessage);
              if (pref.notifications) setNotifications((prev) => ({ ...prev, ...pref.notifications }));
            }
          } catch (e) {
            console.warn('Preferences load error:', e);
          }
        }
      } else {
        // Direct client fallback
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          setUserId(user.id);
          setUserEmail(user.email || '');
          const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
          if (p) {
            setProfile(p);
            setAvatarUrl(p.avatar_url || p.photo_url || null);
            setUsername(p.username || '');
            setFullName(p.full_name || '');
            setDob(p.dob || p.date_of_birth || '');
            setNameVisibility(p.name_visibility || 'FULL');
            setCurrency(p.preferred_currency || 'USD');
            const kStatus = p.kyc_status || 'NOT_SUBMITTED';
            setKycStatus(kStatus);
            if (kStatus === 'PENDING' || kStatus === 'VERIFIED') setIsKycSubmitted(true);
            setIs2faEnabled(Boolean(p.is_2fa_enabled));
            if (p.security_question) setSecQuestion(p.security_question);
          }
        }
      }

      fetchBlockedUsers();
    } catch (err) {
      console.error('Settings load failed:', err);
      notify('error', 'Could not load your settings data.');
    } finally {
      setLoading(false);
    }
  }

  async function fetchBlockedUsers() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('user_blocks')
        .select('id, blocked_user_id, created_at, reason')
        .eq('user_id', user.id);
      if (data) setBlockedUsers(data);
    } catch {
      // Optional table
    }
  }

  const saveLocalPreferences = (updates: Record<string, any>) => {
    if (typeof window === 'undefined' || !userId) return;
    try {
      const existing = JSON.parse(localStorage.getItem(`p2p_preferences_${userId}`) || '{}');
      const merged = { ...existing, ...updates };
      localStorage.setItem(`p2p_preferences_${userId}`, JSON.stringify(merged));
    } catch (e) {
      console.warn('Error saving local pref:', e);
    }
  };

  // =========================================================================
  // CATEGORY 1: PROFILE HANDLERS
  // =========================================================================

  // Upload Picture
  const handleAvatarUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      notify('error', 'Please select a valid image file (JPG, PNG, WEBP).');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      notify('error', 'File size exceeds 5MB limit.');
      return;
    }

    setUploadingAvatar(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/user/profile/avatar', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to upload photo');

      const newUrl = data.avatarUrl || data.avatar_url;
      setAvatarUrl(newUrl);
      setProfile((prev: any) => ({ ...prev, avatar_url: newUrl, photo_url: newUrl }));
      await broadcastProfileUpdate({ avatar_url: newUrl, photo_url: newUrl });

      notify('success', 'Profile picture updated successfully.');
    } catch (err: any) {
      notify('error', err.message || 'Error updating profile picture.');
    } finally {
      setUploadingAvatar(false);
      if (avatarInputRef.current) avatarInputRef.current.value = '';
    }
  };

  // Delete Picture (Reverts to standard monochrome avatar)
  const handleDeleteAvatar = async () => {
    setSavingField('avatar_delete');
    try {
      const res = await fetch('/api/user/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field: 'avatar', data: { avatarUrl: null } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete photo');

      setAvatarUrl(null);
      setProfile((prev: any) => ({ ...prev, avatar_url: null, photo_url: null }));
      await broadcastProfileUpdate({ avatar_url: null, photo_url: null });

      notify('success', 'Profile picture deleted. Reverted to default avatar.');
    } catch (err: any) {
      notify('error', err.message || 'Error deleting profile picture.');
    } finally {
      setSavingField(null);
    }
  };

  // Real-time Username Checker
  const handleUsernameChange = (val: string) => {
    const clean = val.toLowerCase().trim();
    setUsername(clean);
    setUsernameAvailable(null);
    setUsernameReason('');

    if (usernameTimer) clearTimeout(usernameTimer);

    if (!clean || clean === profile?.username) {
      setIsCheckingUsername(false);
      return;
    }

    if (!/^[a-z0-9._]{3,25}$/.test(clean)) {
      setIsCheckingUsername(false);
      setUsernameAvailable(false);
      setUsernameReason('Must be 3-25 characters (lowercase letters, numbers, dots, underscores).');
      return;
    }

    setIsCheckingUsername(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/user/check-username', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: clean }),
        });
        const result = await res.json();
        setUsernameAvailable(result.available);
        if (!result.available) {
          setUsernameReason(result.reason || 'This username is already taken.');
        }
      } catch {
        setUsernameAvailable(false);
        setUsernameReason('Unable to verify username availability.');
      } finally {
        setIsCheckingUsername(false);
      }
    }, 400);

    setUsernameTimer(timer);
  };

  // Save Username
  const handleSaveUsername = async () => {
    if (username === profile?.username) {
      notify('info', 'This is already your current username.');
      return;
    }
    if (usernameAvailable === false) {
      notify('error', usernameReason || 'Please choose a valid and available username.');
      return;
    }

    setSavingField('username');
    try {
      const res = await fetch('/api/user/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field: 'username', data: { username } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update username');

      const updatedUname = data.updatedValue || username;
      setProfile((prev: any) => ({ ...prev, username: updatedUname, display_name: updatedUname }));
      setUsernameAvailable(null);
      await broadcastProfileUpdate({ username: updatedUname, display_name: updatedUname });

      notify('success', 'Username updated and saved successfully.');
    } catch (err: any) {
      notify('error', err.message || 'Failed to save username.');
    } finally {
      setSavingField(null);
    }
  };

  // Save Personal Information
  const handleSavePersonalInfo = async () => {
    setSavingField('personal_info');
    try {
      const res = await fetch('/api/user/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          field: 'personal_info',
          data: {
            fullName: isKycLocked ? undefined : fullName,
            dob: isKycLocked ? undefined : dob,
            nameVisibility,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update personal details');

      const updatedDisplayName = fullName || profile?.username;
      setProfile((prev: any) => ({
        ...prev,
        full_name: isKycLocked ? prev.full_name : fullName,
        dob: isKycLocked ? prev.dob : dob,
        date_of_birth: isKycLocked ? prev.date_of_birth : dob,
        name_visibility: nameVisibility,
        display_name: updatedDisplayName,
      }));
      await broadcastProfileUpdate({ full_name: fullName, display_name: updatedDisplayName });

      notify('success', data.message || 'Personal information saved successfully.');
    } catch (err: any) {
      notify('error', err.message || 'Failed to save personal info.');
    } finally {
      setSavingField(null);
    }
  };

  // =========================================================================
  // CATEGORY 2: PREFERENCES HANDLERS
  // =========================================================================

  const handleSavePreferences = async () => {
    setSavingField('preferences');
    try {
      await fetch('/api/user/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          field: 'currency',
          data: { currency },
        }),
      });

      saveLocalPreferences({
        language,
        timezone,
        autoReplyMessage,
        notifications,
      });

      setProfile((prev: any) => ({ ...prev, preferred_currency: currency }));
      notify('success', 'Preferences saved successfully.');
    } catch (err: any) {
      notify('error', err.message || 'Failed to save preferences.');
    } finally {
      setSavingField(null);
    }
  };

  // =========================================================================
  // CATEGORY 3: SECURITY HANDLERS (SUB-SUB CATEGORIES)
  // =========================================================================

  const handleUpdatePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!currentPassword) {
      notify('error', 'Please enter your current password.');
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      notify('error', 'New password must be at least 6 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      notify('error', 'New password and confirm password do not match.');
      return;
    }

    setSavingField('password');
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setActiveSecSub('none');
      notify('success', 'Account password updated successfully.');
    } catch (err: any) {
      notify('error', err.message || 'Failed to update password.');
    } finally {
      setSavingField(null);
    }
  };

  // Verify 6-digit OTP to enable 2FA
  const handleVerifyAndEnable2fa = async (e: FormEvent) => {
    e.preventDefault();
    const cleanOtp = twoFaOtpCode.trim();
    if (!cleanOtp || !/^\d{6}$/.test(cleanOtp)) {
      notify('error', 'Please enter a valid 6-digit verification code from your authenticator app.');
      return;
    }

    setVerifying2fa(true);
    try {
      const res = await fetch('/api/user/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          field: 'two_factor',
          data: { enabled: true, code: cleanOtp },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to verify 2FA code.');

      setIs2faEnabled(true);
      setTwoFaOtpCode('');
      setProfile((prev: any) => ({ ...prev, is_2fa_enabled: true }));
      notify('success', 'Two-Factor Authentication verified and enabled successfully.');
    } catch (err: any) {
      notify('error', err.message || 'Failed to activate 2FA.');
    } finally {
      setVerifying2fa(false);
    }
  };

  // Disable 2FA
  const handleDisable2fa = async () => {
    setSavingField('2fa');
    try {
      const res = await fetch('/api/user/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          field: 'two_factor',
          data: { enabled: false },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to disable 2FA');

      setIs2faEnabled(false);
      setTwoFaOtpCode('');
      setProfile((prev: any) => ({ ...prev, is_2fa_enabled: false }));
      notify('success', 'Two-Factor Authentication disabled.');
    } catch (err: any) {
      notify('error', err.message || 'Failed to disable 2FA.');
    } finally {
      setSavingField(null);
    }
  };

  const handleSaveSecurityQuestion = async () => {
    if (!secAnswer.trim()) {
      notify('error', 'Please enter an answer to your security question.');
      return;
    }

    setSavingField('security_question');
    try {
      const res = await fetch('/api/user/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          field: 'security_question',
          data: { question: secQuestion, answer: secAnswer },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save security question');

      setProfile((prev: any) => ({ ...prev, security_question: secQuestion }));
      setSecAnswer('');
      setActiveSecSub('none');
      notify('success', 'Security recovery question saved successfully.');
    } catch (err: any) {
      notify('error', err.message || 'Failed to save security question.');
    } finally {
      setSavingField(null);
    }
  };

  const handleUnblockUser = async (blockId: string) => {
    setUnblockingId(blockId);
    try {
      const { error } = await supabase.from('user_blocks').delete().eq('id', blockId);
      if (error) throw error;
      setBlockedUsers((prev) => prev.filter((b) => b.id !== blockId));
      notify('success', 'User unblocked successfully.');
    } catch (err: any) {
      notify('error', err.message || 'Failed to unblock user.');
    } finally {
      setUnblockingId(null);
    }
  };

  // =========================================================================
  // CATEGORY 4: IDENTITY VERIFICATION HANDLERS
  // =========================================================================

  const handleFrontDocSelected = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      notify('error', 'File exceeds 10MB limit.');
      return;
    }
    setFrontDocFile(file);
    setFrontDocName(file.name);
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => setFrontDocPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleBackDocSelected = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      notify('error', 'File exceeds 10MB limit.');
      return;
    }
    setBackDocFile(file);
    setBackDocName(file.name);
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => setBackDocPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleSubmitKycPermanent = async (e: FormEvent) => {
    e.preventDefault();

    if (!kycCountry) {
      notify('error', 'Please select your regional country.');
      return;
    }
    if (!kycDocNumber.trim()) {
      notify('error', 'Please enter your document identification number.');
      return;
    }
    if (!kycStreet.trim() || !kycCity.trim()) {
      notify('error', 'Please enter your street address and city.');
      return;
    }
    if (!frontDocFile && !frontDocName) {
      notify('error', 'Please attach the front scan of your identification document.');
      return;
    }

    setSubmittingKyc(true);
    try {
      const res = await fetch('/api/user/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          field: 'kyc_submission',
          data: {
            country: kycCountry,
            documentType: kycDocType,
            documentNumber: kycDocNumber,
            street: kycStreet,
            city: kycCity,
            postalCode: kycPostalCode,
            frontDocName: frontDocName || 'front_id.jpg',
            backDocName: backDocName || 'back_id.jpg',
            submittedAt: new Date().toISOString(),
          },
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit verification');

      setIsKycSubmitted(true);
      setKycStatus('PENDING');
      setProfile((prev: any) => ({
        ...prev,
        kyc_status: 'PENDING',
        country: kycCountry,
      }));

      notify('success', 'Documents permanently submitted and saved for Tier 2 verification.');
    } catch (err: any) {
      notify('error', err.message || 'Error submitting identification documents.');
    } finally {
      setSubmittingKyc(false);
    }
  };

  // =========================================================================
  // RENDER DEFAULT AVATAR (EXACT MONOCHROME SILHOUETTE)
  // =========================================================================
  const renderUserAvatar = (sizeClass = 'w-16 h-16 sm:w-20 sm:h-20') => {
    if (avatarUrl) {
      return (
        <img
          src={avatarUrl}
          alt="Avatar"
          className={`${sizeClass} rounded-full object-cover border-2 border-primary/40 shadow-xs shrink-0`}
        />
      );
    }

    // Default Avatar (Standard silhouette matching user uploaded image)
    return (
      <div className={`${sizeClass} rounded-full overflow-hidden border-2 border-primary/40 shadow-xs shrink-0 select-none bg-[#18181b]`}>
        <img
          src="/default-avatar.svg"
          alt="Default Avatar"
          className="w-full h-full object-cover"
        />
      </div>
    );
  };

  // Selected Country Data
  const selectedCountryObj = useMemo(() => {
    return ALL_COUNTRIES.find((c) => c.code === kycCountry) || {
      code: kycCountry,
      name: kycCountry,
      flag: '🌐',
    };
  }, [kycCountry]);

  // Selected Currency Data
  const selectedCurrencyObj = useMemo(() => {
    return ALL_CURRENCIES.find((c) => c.code === currency) || {
      code: currency,
      name: currency,
      symbol: currency,
      flag: '💰',
    };
  }, [currency]);

  // Selected Timezone Data
  const selectedTimezoneObj = useMemo(() => {
    return (
      ALL_UTC_TIMEZONES.find((t) => t.offset === timezone || t.name === timezone) ||
      ALL_UTC_TIMEZONES[14] // UTC±00:00 default
    );
  }, [timezone]);

  // =========================================================================
  // MAIN VIEW: LOADING SKELETON
  // =========================================================================
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
        <Loader2 className="w-8 h-8 text-primary animate-spin mb-4" />
        <p className="text-sm font-medium text-muted-foreground">
          Loading settings...
        </p>
      </div>
    );
  }

  const activeTierLabel = isKycSubmitted || kycStatus === 'VERIFIED'
    ? 'Tier 2 (No Limit)'
    : 'Tier 1 (1,000 USD Limit)';

  return (
    <div className="min-h-screen bg-background text-foreground transition-colors py-4 sm:py-8 px-3 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-5 sm:space-y-6">

        {/* TOAST ALERT NOTIFICATION */}
        {toastMsg && (
          <div
            className={`fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg border text-xs sm:text-sm font-medium transition-all max-w-[90vw] ${
              toastMsg.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/90 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100'
                : toastMsg.type === 'error'
                ? 'bg-rose-50 dark:bg-rose-950/90 border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-100'
                : 'bg-primary text-primary-foreground border-primary/20'
            }`}
          >
            {toastMsg.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />}
            {toastMsg.type === 'error' && <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />}
            <span className="flex-1 break-words">{toastMsg.text}</span>
            <button
              onClick={() => setToastMsg(null)}
              className="opacity-70 hover:opacity-100 shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* =================================================================== */}
        {/* TOP OF SETTINGS PAGE: PERFECT MOBILE & DESKTOP RESPONSIVE HEADER    */}
        {/* NAME, USERNAME, EMAIL ADDRESS, TIER, AVATAR / DP, VERIFIED BADGE    */}
        {/* =================================================================== */}
        <div className="bg-card border border-border rounded-2xl p-4 sm:p-6 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start sm:items-center gap-3.5 sm:gap-5 min-w-0 flex-1">
              {/* Avatar / DP (default or custom) */}
              <div className="relative group shrink-0">
                {renderUserAvatar('w-16 h-16 sm:w-20 sm:h-20')}
              </div>

              {/* User details */}
              <div className="space-y-1 min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-base sm:text-xl font-bold tracking-tight text-foreground truncate max-w-full">
                    {fullName || profile?.full_name || profile?.username || 'User Profile'}
                  </h1>

                  {/* Tier Badge */}
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] sm:text-xs font-semibold bg-primary/10 text-primary border border-primary/25 shrink-0">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    {activeTierLabel}
                  </span>
                </div>

                {/* Username */}
                <p className="text-xs sm:text-sm font-semibold text-primary truncate">
                  @{profile?.username || username || 'username'}
                </p>

                {/* Email Address & Verified Badge - wrapped for mobile so it NEVER clips or hides */}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground pt-0.5">
                  <div className="flex items-center gap-1.5 min-w-0 max-w-full">
                    <Mail className="w-3.5 h-3.5 text-primary shrink-0" />
                    <span className="font-medium text-foreground/90 break-all text-[11px] sm:text-xs">
                      {userEmail || 'No email registered'}
                    </span>
                  </div>
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/25 shrink-0">
                    <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                    Verified
                  </span>
                </div>
              </div>
            </div>

            {/* Back Button for Mobile & Desktop when inside sub-category */}
            {activeCategory !== 'all' && (
              <button
                type="button"
                id="top-back-btn"
                onClick={() => setActiveCategory('all')}
                className="self-start sm:self-center flex items-center justify-center gap-2 text-xs font-bold text-primary bg-primary/10 hover:bg-primary/20 px-3.5 py-2 rounded-xl transition-colors border border-primary/20 w-full sm:w-auto shrink-0 cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>All Categories</span>
              </button>
            )}
          </div>
        </div>

        {/* =================================================================== */}
        {/* 1. INITIAL /settings VIEW: NOT LIKE BOX, ONLY SIMPLE LIST           */}
        {/* =================================================================== */}
        {activeCategory === 'all' && (
          <div className="space-y-3 sm:space-y-4 animate-fadeIn">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Settings Categories
              </h2>
              <span className="text-xs text-muted-foreground">
                Select an option to view
              </span>
            </div>

            {/* Simple List (Not like box, unified list with dividers) */}
            <div className="bg-card border border-border rounded-2xl divide-y divide-border overflow-hidden shadow-xs">
              {CATEGORIES_LIST.map((item) => {
                const ItemIcon = item.icon;
                return (
                  <button
                    key={item.key}
                    id={`settings-list-item-${item.key}`}
                    type="button"
                    onClick={() => setActiveCategory(item.key)}
                    className="w-full flex items-center justify-between p-4 sm:p-5 hover:bg-muted/40 transition-colors text-left group cursor-pointer"
                  >
                    <div className="flex items-center gap-3.5 sm:gap-4 min-w-0">
                      {/* Round theme-colored purple-blue icon */}
                      <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground flex items-center justify-center transition-all duration-200 shrink-0">
                        <ItemIcon className="w-5 h-5" />
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm sm:text-base font-bold text-foreground group-hover:text-primary transition-colors">
                            {item.title}
                          </span>
                          {item.badgeText && (
                            <span className="hidden sm:inline-flex text-[11px] font-semibold px-2 py-0.5 rounded-md bg-secondary text-secondary-foreground border border-border">
                              {item.badgeText}
                            </span>
                          )}
                        </div>
                        <p className="text-xs sm:text-sm text-muted-foreground truncate mt-0.5">
                          {item.subtitle}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pl-3 shrink-0">
                      <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* 2. OPENED CATEGORY VIEW: TABS & SUB-CATEGORY SETTINGS FORMS         */}
        {/* =================================================================== */}
        {activeCategory !== 'all' && (
          <div className="space-y-5 sm:space-y-6 animate-fadeIn">
            {/* Navigation Tabs Pill Bar */}
            <div className="bg-card border border-border rounded-2xl p-2.5 sm:p-3 shadow-xs flex items-center justify-between gap-2 overflow-x-auto scrollbar-none">
              <button
                id="back-to-list-pill"
                type="button"
                onClick={() => setActiveCategory('all')}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-muted-foreground hover:text-foreground bg-secondary hover:bg-secondary/80 transition-colors whitespace-nowrap cursor-pointer shrink-0"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Categories</span>
              </button>

              <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
                {CATEGORIES_LIST.map((item) => {
                  const isSelected = activeCategory === item.key;
                  const TabIcon = item.icon;
                  return (
                    <button
                      key={item.key}
                      id={`tab-pill-${item.key}`}
                      type="button"
                      onClick={() => setActiveCategory(item.key)}
                      className={`flex items-center gap-1.5 px-3 sm:px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-primary text-primary-foreground shadow-xs font-bold'
                          : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                      }`}
                    >
                      <TabIcon className="w-3.5 h-3.5" />
                      <span>{item.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* =============================================================== */}
            {/* 1. PROFILE (ALL IN ONE UNIFIED PAGE)                             */}
            {/* =============================================================== */}
            {activeCategory === 'profile' && (
              <div className="space-y-5 sm:space-y-6">
                {/* Profile Picture: Upload, Delete & Default Monochrome Avatar */}
                <div className="bg-card border border-border rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-border">
                    <div>
                      <h2 className="text-base font-bold text-foreground">Profile Picture</h2>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Standard silhouette avatar is used by default. Upload a picture or delete your picture to restore default.
                      </p>
                    </div>
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 shrink-0">
                      {avatarUrl ? 'Custom Picture Active' : 'Default Avatar'}
                    </span>
                  </div>

                  <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5 pt-1">
                    {/* Visual DP preview */}
                    <div className="relative group shrink-0">
                      {renderUserAvatar('w-20 h-20 sm:w-24 sm:h-24')}
                      {uploadingAvatar && (
                        <div className="absolute inset-0 bg-black/60 rounded-full flex items-center justify-center">
                          <Loader2 className="w-6 h-6 text-white animate-spin" />
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="space-y-3 flex-1 text-center sm:text-left">
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          {profile?.username ? `@${profile.username}` : userEmail}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Supported formats: JPG, PNG, WEBP. Maximum file size: 5MB.
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2.5">
                        <input
                          type="file"
                          ref={avatarInputRef}
                          onChange={handleAvatarUpload}
                          accept="image/png,image/jpeg,image/webp"
                          className="hidden"
                          id="avatar-file-input"
                        />
                        <button
                          type="button"
                          id="upload-avatar-btn"
                          disabled={uploadingAvatar}
                          onClick={() => avatarInputRef.current?.click()}
                          className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-xs disabled:opacity-50 cursor-pointer"
                        >
                          {uploadingAvatar ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Upload className="w-3.5 h-3.5" />
                          )}
                          <span>Upload Picture</span>
                        </button>

                        {avatarUrl && (
                          <button
                            type="button"
                            id="delete-avatar-btn"
                            disabled={savingField === 'avatar_delete'}
                            onClick={handleDeleteAvatar}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 transition-colors disabled:opacity-50 cursor-pointer"
                          >
                            {savingField === 'avatar_delete' ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="w-3.5 h-3.5" />
                            )}
                            <span>Delete Picture</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Change Username & Save Username Button */}
                <div className="bg-card border border-border rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-border">
                    <div>
                      <h2 className="text-base font-bold text-foreground">Change Username</h2>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Your unique trading handle displayed across public trade ads and escrow rooms.
                      </p>
                    </div>
                    {usernameAvailable === true && (
                      <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                        <Check className="w-3.5 h-3.5" /> Available
                      </span>
                    )}
                    {usernameAvailable === false && (
                      <span className="flex items-center gap-1 text-[11px] font-bold text-rose-600 dark:text-rose-400">
                        <X className="w-3.5 h-3.5" /> Taken / Invalid
                      </span>
                    )}
                  </div>

                  <div className="space-y-3">
                    <label className="block text-xs font-semibold text-foreground">
                      Trading Username Handle
                    </label>
                    <div className="relative max-w-md">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-primary font-bold text-sm">
                        @
                      </span>
                      <input
                        type="text"
                        id="input-username"
                        value={username}
                        onChange={(e) => handleUsernameChange(e.target.value)}
                        placeholder="your_handle"
                        className="w-full pl-8 pr-10 py-2.5 rounded-xl border border-input bg-background text-sm font-medium focus:ring-2 focus:ring-primary focus:border-primary focus:outline-none transition-all"
                      />
                      {isCheckingUsername && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                          <Loader2 className="w-4 h-4 text-primary animate-spin" />
                        </div>
                      )}
                    </div>

                    {usernameReason && (
                      <p className="text-xs text-rose-500">{usernameReason}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Requirements: 3-25 characters using lowercase letters, numbers, dots, and underscores.
                    </p>

                    <div className="pt-2">
                      <button
                        type="button"
                        id="save-username-btn"
                        disabled={
                          savingField === 'username' ||
                          username === profile?.username ||
                          usernameAvailable === false ||
                          isCheckingUsername
                        }
                        onClick={handleSaveUsername}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-xs disabled:opacity-50 cursor-pointer"
                      >
                        {savingField === 'username' ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Check className="w-3.5 h-3.5" />
                        )}
                        <span>Save Username</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Personal Information: Full Name, Date of Birth, Email, Name Visibility & Save Button */}
                {/* Note: Full Name & DOB are disabled when KYC verified according to KYC document */}
                <div className="bg-card border border-border rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
                  <div className="pb-3 border-b border-border flex items-center justify-between">
                    <div>
                      <h2 className="text-base font-bold text-foreground">Personal Information</h2>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Legal identification details, verified account email, and counterparty privacy controls.
                      </p>
                    </div>
                    {isKycLocked && (
                      <span className="flex items-center gap-1 text-[11px] font-bold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/25">
                        <Lock className="w-3 h-3" /> KYC Document Locked
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
                    {/* Full Name */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="block text-xs font-semibold text-foreground">
                          Full Name
                        </label>
                        {isKycLocked && (
                          <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium flex items-center gap-1">
                            <Lock className="w-2.5 h-2.5" /> Locked to KYC Document
                          </span>
                        )}
                      </div>
                      <input
                        type="text"
                        id="input-fullname"
                        value={fullName}
                        disabled={isKycLocked}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="John Doe"
                        className={`w-full px-3.5 py-2.5 rounded-xl border text-sm transition-all ${
                          isKycLocked
                            ? 'bg-muted/50 border-border text-muted-foreground cursor-not-allowed'
                            : 'bg-background border-input focus:ring-2 focus:ring-primary focus:border-primary focus:outline-none'
                        }`}
                      />
                      {isKycLocked && (
                        <p className="text-[10px] text-muted-foreground">
                          Legal name is permanently locked to your submitted identity document.
                        </p>
                      )}
                    </div>

                    {/* Date of Birth */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="block text-xs font-semibold text-foreground">
                          Date of Birth
                        </label>
                        {isKycLocked && (
                          <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium flex items-center gap-1">
                            <Lock className="w-2.5 h-2.5" /> Locked to KYC Document
                          </span>
                        )}
                      </div>
                      <input
                        type="date"
                        id="input-dob"
                        value={dob}
                        disabled={isKycLocked}
                        onChange={(e) => setDob(e.target.value)}
                        className={`w-full px-3.5 py-2.5 rounded-xl border text-sm transition-all ${
                          isKycLocked
                            ? 'bg-muted/50 border-border text-muted-foreground cursor-not-allowed'
                            : 'bg-background border-input focus:ring-2 focus:ring-primary focus:border-primary focus:outline-none'
                        }`}
                      />
                    </div>

                    {/* My Email (Read-only verified box with full mobile responsive wrap) */}
                    <div className="sm:col-span-2 space-y-1.5">
                      <label className="block text-xs font-semibold text-foreground">
                        My Email Address
                      </label>
                      <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl border border-border bg-secondary/50">
                        <div className="flex items-center gap-2.5 min-w-0 max-w-full">
                          <Mail className="w-4 h-4 text-primary shrink-0" />
                          <span className="text-xs sm:text-sm font-medium text-foreground break-all">
                            {userEmail || 'No email associated'}
                          </span>
                        </div>
                        <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 shrink-0">
                          <CheckCircle2 className="w-3 h-3" /> Verified
                        </span>
                      </div>
                    </div>

                    {/* Name Visibility: Show full name, Partial Name, or hide name */}
                    <div className="sm:col-span-2 space-y-2 pt-2">
                      <label className="block text-xs font-semibold text-foreground">
                        Counterparty Name Privacy
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        <button
                          type="button"
                          id="vis-full-btn"
                          onClick={() => setNameVisibility('FULL')}
                          className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                            nameVisibility === 'FULL'
                              ? 'border-primary bg-primary/10 text-primary font-bold shadow-xs'
                              : 'border-border bg-card hover:bg-muted/50 text-foreground'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-bold">Show Full Name</span>
                            {nameVisibility === 'FULL' && <Check className="w-3.5 h-3.5 text-primary" />}
                          </div>
                          <p className="text-[11px] text-muted-foreground font-normal">
                            Display your complete legal name on verified ads.
                          </p>
                        </button>

                        <button
                          type="button"
                          id="vis-partial-btn"
                          onClick={() => setNameVisibility('PARTIAL')}
                          className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                            nameVisibility === 'PARTIAL'
                              ? 'border-primary bg-primary/10 text-primary font-bold shadow-xs'
                              : 'border-border bg-card hover:bg-muted/50 text-foreground'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-bold">Partial Name</span>
                            {nameVisibility === 'PARTIAL' && <Check className="w-3.5 h-3.5 text-primary" />}
                          </div>
                          <p className="text-[11px] text-muted-foreground font-normal">
                            Show first name and initial only (e.g. John D.).
                          </p>
                        </button>

                        <button
                          type="button"
                          id="vis-hide-btn"
                          onClick={() => setNameVisibility('HIDE')}
                          className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                            nameVisibility === 'HIDE'
                              ? 'border-primary bg-primary/10 text-primary font-bold shadow-xs'
                              : 'border-border bg-card hover:bg-muted/50 text-foreground'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-bold">Hide Name</span>
                            {nameVisibility === 'HIDE' && <Check className="w-3.5 h-3.5 text-primary" />}
                          </div>
                          <p className="text-[11px] text-muted-foreground font-normal">
                            Display only your trading handle @{profile?.username || username || 'username'}.
                          </p>
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-border">
                    <button
                      type="button"
                      id="save-personal-info-btn"
                      disabled={savingField === 'personal_info'}
                      onClick={handleSavePersonalInfo}
                      className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-xs disabled:opacity-50 cursor-pointer"
                    >
                      {savingField === 'personal_info' ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Check className="w-3.5 h-3.5" />
                      )}
                      <span>Save Personal Information</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* =============================================================== */}
            {/* 2. PREFERENCES (ALL IN ONE UNIFIED PAGE - NO ESCROW WINDOW)      */}
            {/* =============================================================== */}
            {activeCategory === 'preferences' && (
              <div className="space-y-5 sm:space-y-6">
                {/* Trading Preferences: Currency, Language, All UTC Timezones, Auto-reply */}
                <div className="bg-card border border-border rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
                  <div className="pb-3 border-b border-border">
                    <h2 className="text-base font-bold text-foreground">Trading Preferences</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Configure your default fiat currency with search, platform language, all world UTC timezones, and trade auto-reply.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
                    {/* Default Fiat Currency with searchable modal/dropdown */}
                    <div className="space-y-1.5 relative">
                      <label className="block text-xs font-semibold text-foreground">
                        Default Fiat Currency
                      </label>
                      <button
                        type="button"
                        id="currency-select-trigger"
                        onClick={() => {
                          setIsCurrencyModalOpen(!isCurrencyModalOpen);
                          setCurrencySearchQuery('');
                        }}
                        className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border border-input bg-background text-sm text-left hover:border-primary transition-all cursor-pointer"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="text-base">{selectedCurrencyObj.flag}</span>
                          <span className="font-bold text-foreground">{selectedCurrencyObj.code}</span>
                          <span className="text-xs text-muted-foreground truncate">
                            {selectedCurrencyObj.name} ({selectedCurrencyObj.symbol})
                          </span>
                        </div>
                        <Search className="w-4 h-4 text-muted-foreground shrink-0 ml-2" />
                      </button>

                      {/* Searchable Currencies Popup */}
                      {isCurrencyModalOpen && (
                        <div className="absolute z-40 left-0 right-0 top-full mt-1.5 bg-card border border-border rounded-2xl shadow-xl p-3 space-y-2 max-h-72 flex flex-col">
                          <div className="relative">
                            <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                            <input
                              type="text"
                              autoFocus
                              placeholder="Search currency by code or name..."
                              value={currencySearchQuery}
                              onChange={(e) => setCurrencySearchQuery(e.target.value)}
                              className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-input bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                          </div>
                          <div className="overflow-y-auto space-y-1 flex-1 pr-1">
                            {filteredCurrencies.map((c) => (
                              <button
                                key={c.code}
                                type="button"
                                onClick={() => {
                                  setCurrency(c.code);
                                  setIsCurrencyModalOpen(false);
                                }}
                                className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs transition-colors cursor-pointer ${
                                  currency === c.code
                                    ? 'bg-primary/10 text-primary font-bold'
                                    : 'hover:bg-muted/60 text-foreground'
                                }`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="text-sm">{c.flag}</span>
                                  <span className="font-bold">{c.code}</span>
                                  <span className="text-muted-foreground truncate">{c.name}</span>
                                </div>
                                <span className="font-mono text-muted-foreground">{c.symbol}</span>
                              </button>
                            ))}
                            {filteredCurrencies.length === 0 && (
                              <p className="text-xs text-muted-foreground text-center py-4">
                                No currencies found matching &quot;{currencySearchQuery}&quot;
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                      <p className="text-[11px] text-muted-foreground">Default currency filter when browsing buy/sell offers.</p>
                    </div>

                    {/* Platform Language */}
                    <div className="space-y-1.5">
                      <label className="block text-xs font-semibold text-foreground">
                        Platform Language
                      </label>
                      <select
                        id="select-language"
                        value={language}
                        onChange={(e) => setLanguage(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-input bg-background text-sm focus:ring-2 focus:ring-primary focus:border-primary focus:outline-none cursor-pointer"
                      >
                        {LANGUAGES.map((l) => (
                          <option key={l.code} value={l.code}>
                            {l.name}
                          </option>
                        ))}
                      </select>
                      <p className="text-[11px] text-muted-foreground">App interface and prompt language.</p>
                    </div>

                    {/* Preferred Time Zone: ALL UTC TIMEZONES WITH SEARCH */}
                    <div className="sm:col-span-2 space-y-1.5 relative">
                      <label className="block text-xs font-semibold text-foreground">
                        Preferred Time Zone (All UTC Offsets)
                      </label>
                      <button
                        type="button"
                        id="timezone-select-trigger"
                        onClick={() => {
                          setIsTimezoneModalOpen(!isTimezoneModalOpen);
                          setTimezoneSearchQuery('');
                        }}
                        className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border border-input bg-background text-sm text-left hover:border-primary transition-all cursor-pointer"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 shrink-0">
                            {selectedTimezoneObj.offset}
                          </span>
                          <span className="font-semibold text-foreground text-xs sm:text-sm truncate">
                            {selectedTimezoneObj.name}
                          </span>
                          <span className="hidden md:inline text-xs text-muted-foreground truncate">
                            ({selectedTimezoneObj.cities})
                          </span>
                        </div>
                        <Search className="w-4 h-4 text-muted-foreground shrink-0 ml-2" />
                      </button>

                      {/* Searchable Timezones Popup */}
                      {isTimezoneModalOpen && (
                        <div className="absolute z-40 left-0 right-0 top-full mt-1.5 bg-card border border-border rounded-2xl shadow-xl p-3 space-y-2 max-h-72 flex flex-col">
                          <div className="relative">
                            <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                            <input
                              type="text"
                              autoFocus
                              placeholder="Search by UTC offset (+5:30, -05:00), city (London, New York, Tokyo), or name..."
                              value={timezoneSearchQuery}
                              onChange={(e) => setTimezoneSearchQuery(e.target.value)}
                              className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-input bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                          </div>
                          <div className="overflow-y-auto space-y-1 flex-1 pr-1">
                            {filteredTimezones.map((tz) => (
                              <button
                                key={tz.offset}
                                type="button"
                                onClick={() => {
                                  setTimezone(tz.offset);
                                  setIsTimezoneModalOpen(false);
                                }}
                                className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs transition-colors text-left cursor-pointer ${
                                  timezone === tz.offset
                                    ? 'bg-primary/10 text-primary font-bold'
                                    : 'hover:bg-muted/60 text-foreground'
                                }`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="font-mono font-bold px-1.5 py-0.5 rounded bg-secondary text-[11px] shrink-0">
                                    {tz.offset}
                                  </span>
                                  <span className="truncate">{tz.name}</span>
                                </div>
                                <span className="text-[11px] text-muted-foreground truncate pl-2 shrink-0 max-w-[40%] text-right">
                                  {tz.cities}
                                </span>
                              </button>
                            ))}
                            {filteredTimezones.length === 0 && (
                              <p className="text-xs text-muted-foreground text-center py-4">
                                No UTC timezone found matching &quot;{timezoneSearchQuery}&quot;
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                      <p className="text-[11px] text-muted-foreground">Trade timestamps and chat history displayed in this UTC reference.</p>
                    </div>

                    {/* Auto-Reply Message */}
                    <div className="sm:col-span-2 space-y-1.5">
                      <label className="block text-xs font-semibold text-foreground">
                        Auto-Reply Message for Trade Chat
                      </label>
                      <textarea
                        id="input-auto-reply"
                        rows={3}
                        value={autoReplyMessage}
                        onChange={(e) => setAutoReplyMessage(e.target.value)}
                        placeholder="Hello! I am online and ready to trade. Please transfer using your own registered bank account."
                        className="w-full px-3.5 py-2.5 rounded-xl border border-input bg-background text-sm focus:ring-2 focus:ring-primary focus:border-primary focus:outline-none"
                      />
                    </div>
                  </div>
                </div>

                {/* Notification and Alerts */}
                <div className="bg-card border border-border rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
                  <div className="pb-3 border-b border-border">
                    <h2 className="text-base font-bold text-foreground">Notifications & Alerts</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Select which trade events trigger push alerts, emails, and sound cues.
                    </p>
                  </div>

                  <div className="divide-y divide-border">
                    <label className="flex items-center justify-between py-3 cursor-pointer">
                      <div>
                        <p className="text-xs font-semibold text-foreground">
                          Trade Requests & New Orders
                        </p>
                        <p className="text-[11px] text-muted-foreground">Receive alerts when someone opens a trade on your ad.</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={notifications.email_trade_requests}
                        onChange={(e) => setNotifications({ ...notifications, email_trade_requests: e.target.checked })}
                        className="w-4 h-4 rounded text-primary focus:ring-primary cursor-pointer"
                      />
                    </label>

                    <label className="flex items-center justify-between py-3 cursor-pointer">
                      <div>
                        <p className="text-xs font-semibold text-foreground">
                          Escrow Deposit & Payment Sent Alerts
                        </p>
                        <p className="text-[11px] text-muted-foreground">Notified as soon as escrow is locked or marked paid.</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={notifications.email_payment_sent}
                        onChange={(e) => setNotifications({ ...notifications, email_payment_sent: e.target.checked })}
                        className="w-4 h-4 rounded text-primary focus:ring-primary cursor-pointer"
                      />
                    </label>

                    <label className="flex items-center justify-between py-3 cursor-pointer">
                      <div>
                        <p className="text-xs font-semibold text-foreground">
                          In-App Chat & Trade Room Messages
                        </p>
                        <p className="text-[11px] text-muted-foreground">Alerts for new messages inside active trade rooms.</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={notifications.chat_messages}
                        onChange={(e) => setNotifications({ ...notifications, chat_messages: e.target.checked })}
                        className="w-4 h-4 rounded text-primary focus:ring-primary cursor-pointer"
                      />
                    </label>

                    <label className="flex items-center justify-between py-3 cursor-pointer">
                      <div>
                        <p className="text-xs font-semibold text-foreground">
                          Sound Alerts
                        </p>
                        <p className="text-[11px] text-muted-foreground">Audible chime when a trade message or status change arrives.</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={notifications.sound_alerts}
                        onChange={(e) => setNotifications({ ...notifications, sound_alerts: e.target.checked })}
                        className="w-4 h-4 rounded text-primary focus:ring-primary cursor-pointer"
                      />
                    </label>
                  </div>

                  <div className="pt-3 border-t border-border">
                    <button
                      type="button"
                      id="save-preferences-btn"
                      disabled={savingField === 'preferences'}
                      onClick={handleSavePreferences}
                      className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-xs disabled:opacity-50 cursor-pointer"
                    >
                      {savingField === 'preferences' ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Check className="w-3.5 h-3.5" />
                      )}
                      <span>Save Preferences</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* =============================================================== */}
            {/* 3. SECURITY (CLEAN SUB-SUB CATEGORIES ACCORDION)                */}
            {/* Password (Current, New, Confirm), 2FA with 6-digit OTP,        */}
            {/* Security Questions, Blocked Users, Active Sessions              */}
            {/* =============================================================== */}
            {activeCategory === 'security' && (
              <div className="space-y-4">
                <div className="px-1">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Security Protection Sub-Categories
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Tap any option to view and manage your authentication controls.
                  </p>
                </div>

                {/* 1. SUB-SUB CATEGORY: PASSWORD */}
                <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-xs transition-all">
                  <button
                    type="button"
                    onClick={() => setActiveSecSub(activeSecSub === 'password' ? 'none' : 'password')}
                    className="w-full flex items-center justify-between p-4 sm:p-5 text-left hover:bg-muted/40 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-3.5">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                        <Key className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-foreground">Password</h3>
                        <p className="text-xs text-muted-foreground">
                          Update login credentials (current, new, and confirm new password)
                        </p>
                      </div>
                    </div>
                    {activeSecSub === 'password' ? (
                      <ChevronUp className="w-5 h-5 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-muted-foreground" />
                    )}
                  </button>

                  {/* Expanded Password Form */}
                  {activeSecSub === 'password' && (
                    <div className="p-5 sm:p-6 border-t border-border bg-card/60 space-y-4 animate-fadeIn">
                      <form onSubmit={handleUpdatePassword} className="space-y-4 max-w-md">
                        {/* Current Password */}
                        <div className="space-y-1.5">
                          <label className="block text-xs font-semibold text-foreground">
                            Current Password <span className="text-rose-500">*</span>
                          </label>
                          <input
                            type="password"
                            id="input-current-password"
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            placeholder="Enter current password"
                            className="w-full px-3.5 py-2.5 rounded-xl border border-input bg-background text-sm focus:ring-2 focus:ring-primary focus:border-primary focus:outline-none"
                            required
                          />
                        </div>

                        {/* New Password */}
                        <div className="space-y-1.5">
                          <label className="block text-xs font-semibold text-foreground">
                            New Password <span className="text-rose-500">*</span>
                          </label>
                          <input
                            type="password"
                            id="input-new-password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            placeholder="Minimum 6 characters"
                            className="w-full px-3.5 py-2.5 rounded-xl border border-input bg-background text-sm focus:ring-2 focus:ring-primary focus:border-primary focus:outline-none"
                            required
                            minLength={6}
                          />
                        </div>

                        {/* Confirm New Password */}
                        <div className="space-y-1.5">
                          <label className="block text-xs font-semibold text-foreground">
                            Confirm New Password <span className="text-rose-500">*</span>
                          </label>
                          <input
                            type="password"
                            id="input-confirm-password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            placeholder="Re-enter new password"
                            className="w-full px-3.5 py-2.5 rounded-xl border border-input bg-background text-sm focus:ring-2 focus:ring-primary focus:border-primary focus:outline-none"
                            required
                            minLength={6}
                          />
                        </div>

                        <div className="pt-2 flex items-center gap-3">
                          <button
                            type="submit"
                            id="update-password-btn"
                            disabled={savingField === 'password'}
                            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-xs disabled:opacity-50 cursor-pointer"
                          >
                            {savingField === 'password' ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Lock className="w-3.5 h-3.5" />
                            )}
                            <span>Update Password</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setActiveSecSub('none')}
                            className="px-4 py-2.5 rounded-xl text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    </div>
                  )}
                </div>

                {/* 2. SUB-SUB CATEGORY: TWO-FACTOR AUTHENTICATION (2FA) */}
                <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-xs transition-all">
                  <button
                    type="button"
                    onClick={() => setActiveSecSub(activeSecSub === '2fa' ? 'none' : '2fa')}
                    className="w-full flex items-center justify-between p-4 sm:p-5 text-left hover:bg-muted/40 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-3.5">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                        <Smartphone className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-bold text-foreground">Two-Factor Authentication (2FA)</h3>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                              is2faEnabled
                                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                                : 'bg-secondary text-secondary-foreground border-border'
                            }`}
                          >
                            {is2faEnabled ? 'Enabled' : 'Disabled'}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Authenticator app code verification (enables only upon 6-digit OTP verification)
                        </p>
                      </div>
                    </div>
                    {activeSecSub === '2fa' ? (
                      <ChevronUp className="w-5 h-5 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-muted-foreground" />
                    )}
                  </button>

                  {/* Expanded 2FA Setup Form */}
                  {activeSecSub === '2fa' && (
                    <div className="p-5 sm:p-6 border-t border-border bg-card/60 space-y-4 animate-fadeIn">
                      {is2faEnabled ? (
                        <div className="space-y-4">
                          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-start gap-3">
                            <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                            <div>
                              <p className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
                                Two-Factor Authentication is Active
                              </p>
                              <p className="text-[11px] text-muted-foreground mt-0.5">
                                Your account is protected. A 6-digit OTP passcode is required during login and high-value crypto withdrawals.
                              </p>
                            </div>
                          </div>

                          <button
                            type="button"
                            id="disable-2fa-btn"
                            disabled={savingField === '2fa'}
                            onClick={handleDisable2fa}
                            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white transition-colors shadow-xs cursor-pointer disabled:opacity-50"
                          >
                            {savingField === '2fa' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                            <span>Disable 2FA Protection</span>
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-4 max-w-lg">
                          <div className="space-y-1">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
                              Step 1: Link Authenticator App
                            </h4>
                            <p className="text-xs text-muted-foreground">
                              Open Google Authenticator, Authy, or Microsoft Authenticator, and enter this secret key:
                            </p>
                          </div>

                          <div className="flex items-center gap-2 p-3 rounded-xl border border-border bg-secondary/60">
                            <code className="text-xs font-mono font-bold text-primary flex-1 break-all">
                              P2PX-SEC-7734-AUTH-9901
                            </code>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard?.writeText('P2PX-SEC-7734-AUTH-9901');
                                notify('info', 'Secret key copied to clipboard.');
                              }}
                              className="p-1.5 rounded-lg hover:bg-background text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                              title="Copy Secret Key"
                            >
                              <Copy className="w-4 h-4" />
                            </button>
                          </div>

                          <form onSubmit={handleVerifyAndEnable2fa} className="space-y-3 pt-2">
                            <div className="space-y-1">
                              <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
                                Step 2: Verify 6-Digit OTP Code <span className="text-rose-500">*</span>
                              </h4>
                              <p className="text-xs text-muted-foreground">
                                Enter the 6-digit code displayed in your authenticator app to confirm and activate 2FA:
                              </p>
                            </div>

                            <div className="max-w-xs">
                              <input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                maxLength={6}
                                id="input-2fa-otp"
                                value={twoFaOtpCode}
                                onChange={(e) => setTwoFaOtpCode(e.target.value.replace(/\D/g, ''))}
                                placeholder="000000"
                                className="w-full px-4 py-2.5 rounded-xl border border-input bg-background text-center text-lg font-mono font-bold tracking-widest focus:ring-2 focus:ring-primary focus:border-primary focus:outline-none"
                                required
                              />
                            </div>

                            <p className="text-[11px] text-muted-foreground">
                              Two-Factor Authentication is ONLY enabled after successfully entering and verifying the correct 6-digit OTP.
                            </p>

                            <div className="pt-2">
                              <button
                                type="submit"
                                id="verify-enable-2fa-btn"
                                disabled={verifying2fa || twoFaOtpCode.trim().length !== 6}
                                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-xs disabled:opacity-50 cursor-pointer"
                              >
                                {verifying2fa ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                )}
                                <span>Verify OTP & Enable 2FA</span>
                              </button>
                            </div>
                          </form>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 3. SUB-SUB CATEGORY: SECURITY QUESTIONS */}
                <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-xs transition-all">
                  <button
                    type="button"
                    onClick={() => setActiveSecSub(activeSecSub === 'questions' ? 'none' : 'questions')}
                    className="w-full flex items-center justify-between p-4 sm:p-5 text-left hover:bg-muted/40 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-3.5">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                        <HelpCircle className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-foreground">Security Questions</h3>
                        <p className="text-xs text-muted-foreground">
                          Confidential challenge question for account recovery
                        </p>
                      </div>
                    </div>
                    {activeSecSub === 'questions' ? (
                      <ChevronUp className="w-5 h-5 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-muted-foreground" />
                    )}
                  </button>

                  {/* Expanded Security Question Form */}
                  {activeSecSub === 'questions' && (
                    <div className="p-5 sm:p-6 border-t border-border bg-card/60 space-y-4 animate-fadeIn">
                      <div className="space-y-4 max-w-lg">
                        <div className="space-y-1.5">
                          <label className="block text-xs font-semibold text-foreground">
                            Select Security Question
                          </label>
                          <select
                            id="select-sec-question"
                            value={secQuestion}
                            onChange={(e) => setSecQuestion(e.target.value)}
                            className="w-full px-3.5 py-2.5 rounded-xl border border-input bg-background text-sm focus:ring-2 focus:ring-primary focus:border-primary focus:outline-none cursor-pointer"
                          >
                            {SECURITY_QUESTIONS.map((q, idx) => (
                              <option key={idx} value={q}>
                                {q}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="space-y-1.5">
                          <label className="block text-xs font-semibold text-foreground">
                            Your Secret Answer
                          </label>
                          <input
                            type="text"
                            id="input-sec-answer"
                            value={secAnswer}
                            onChange={(e) => setSecAnswer(e.target.value)}
                            placeholder="Type confidential answer..."
                            className="w-full px-3.5 py-2.5 rounded-xl border border-input bg-background text-sm focus:ring-2 focus:ring-primary focus:border-primary focus:outline-none"
                          />
                        </div>

                        <button
                          type="button"
                          id="save-sec-question-btn"
                          disabled={savingField === 'security_question' || !secAnswer.trim()}
                          onClick={handleSaveSecurityQuestion}
                          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-xs disabled:opacity-50 cursor-pointer"
                        >
                          {savingField === 'security_question' ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Check className="w-3.5 h-3.5" />
                          )}
                          <span>Save Security Question</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* 4. SUB-SUB CATEGORY: BLOCKED USERS */}
                <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-xs transition-all">
                  <button
                    type="button"
                    onClick={() => setActiveSecSub(activeSecSub === 'blocked' ? 'none' : 'blocked')}
                    className="w-full flex items-center justify-between p-4 sm:p-5 text-left hover:bg-muted/40 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-3.5">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                        <Ban className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-bold text-foreground">Blocked Users</h3>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground border border-border">
                            {blockedUsers.length} Blocked
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Tap to view full list of counterparties restricted from trading
                        </p>
                      </div>
                    </div>
                    {activeSecSub === 'blocked' ? (
                      <ChevronUp className="w-5 h-5 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-muted-foreground" />
                    )}
                  </button>

                  {/* Expanded Blocked Users List */}
                  {activeSecSub === 'blocked' && (
                    <div className="p-5 sm:p-6 border-t border-border bg-card/60 space-y-3 animate-fadeIn">
                      {blockedUsers.length === 0 ? (
                        <div className="p-6 rounded-xl bg-secondary/40 border border-border text-center space-y-1">
                          <Ban className="w-6 h-6 text-muted-foreground mx-auto" />
                          <p className="text-xs font-semibold text-foreground">No Blocked Users</p>
                          <p className="text-[11px] text-muted-foreground">
                            You have not restricted any counterparties. Any user you block in trade chats will appear here.
                          </p>
                        </div>
                      ) : (
                        <div className="divide-y divide-border">
                          {blockedUsers.map((b) => (
                            <div key={b.id} className="flex items-center justify-between py-3">
                              <div>
                                <p className="text-xs font-bold text-foreground">
                                  User ID: {b.blocked_user_id?.slice(0, 12)}...
                                </p>
                                <p className="text-[11px] text-muted-foreground">
                                  Blocked on {new Date(b.created_at).toLocaleDateString()}
                                </p>
                              </div>
                              <button
                                type="button"
                                disabled={unblockingId === b.id}
                                onClick={() => handleUnblockUser(b.id)}
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-rose-600 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 cursor-pointer"
                              >
                                {unblockingId === b.id ? 'Unblocking...' : 'Unblock'}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 5. SUB-SUB CATEGORY: ACTIVE SESSIONS */}
                <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-xs transition-all">
                  <button
                    type="button"
                    onClick={() => setActiveSecSub(activeSecSub === 'sessions' ? 'none' : 'sessions')}
                    className="w-full flex items-center justify-between p-4 sm:p-5 text-left hover:bg-muted/40 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-3.5">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                        <Laptop className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-bold text-foreground">Active Sessions & Devices</h3>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground border border-border">
                            {sessions.length} Active
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Tap to view all authorized logins and device sessions
                        </p>
                      </div>
                    </div>
                    {activeSecSub === 'sessions' ? (
                      <ChevronUp className="w-5 h-5 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-muted-foreground" />
                    )}
                  </button>

                  {/* Expanded Active Sessions List */}
                  {activeSecSub === 'sessions' && (
                    <div className="p-5 sm:p-6 border-t border-border bg-card/60 space-y-4 animate-fadeIn">
                      <div className="space-y-3">
                        {sessions.map((sess) => (
                          <div
                            key={sess.id}
                            className="flex items-center justify-between p-4 rounded-xl border border-border bg-secondary/40"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                                <Laptop className="w-5 h-5" />
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  <p className="text-xs font-bold text-foreground">{sess.device}</p>
                                  {sess.isCurrent && (
                                    <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.2 rounded border border-emerald-500/20">
                                      This Device
                                    </span>
                                  )}
                                </div>
                                <p className="text-[11px] text-muted-foreground mt-0.5">
                                  {sess.ip} • {sess.lastActive}
                                </p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="pt-2">
                        <button
                          type="button"
                          id="sign-out-all-sessions-btn"
                          onClick={() => notify('success', 'All other devices logged out successfully.')}
                          className="px-4 py-2 rounded-xl text-xs font-bold text-foreground bg-secondary hover:bg-secondary/80 transition-colors cursor-pointer"
                        >
                          Log Out of All Other Devices
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* =============================================================== */}
            {/* 4. IDENTITY VERIFICATION (ALL IN ONE UNIFIED PAGE)               */}
            {/* =============================================================== */}
            {activeCategory === 'identity' && (
              <div className="space-y-5 sm:space-y-6">
                {/* Two Tier System Overview */}
                <div className="bg-card border border-border rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
                  <div>
                    <h2 className="text-base font-bold text-foreground">Trading Tiers & Limits</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Simple two-tier system: Tier 1 requires no KYC; Tier 2 unlocks unlimited trading after document submission.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                    {/* Tier 1 Card */}
                    <div className="p-5 rounded-2xl border border-border bg-secondary/40 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Tier 1</span>
                        <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                          <CheckCircle2 className="w-3 h-3" /> Active by Default
                        </span>
                      </div>
                      <div>
                        <div className="text-2xl font-extrabold text-foreground">1,000 USD</div>
                        <p className="text-xs font-semibold text-muted-foreground mt-0.5">Trading Volume Limit</p>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        <strong>No KYC needed.</strong> Trade up to $1,000 USD total without submitting identification documents.
                      </p>
                    </div>

                    {/* Tier 2 Card */}
                    <div className={`p-5 rounded-2xl border transition-all space-y-3 ${
                      isKycSubmitted || kycStatus === 'VERIFIED'
                        ? 'border-primary/40 bg-primary/5'
                        : 'border-border bg-card'
                    }`}>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold uppercase tracking-wider text-primary">Tier 2</span>
                        {kycStatus === 'VERIFIED' ? (
                          <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                            <ShieldCheck className="w-3 h-3" /> Tier 2 Verified
                          </span>
                        ) : isKycSubmitted ? (
                          <span className="flex items-center gap-1 text-[11px] font-bold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                            <Clock className="w-3 h-3" /> Permanent Saved & In Review
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-[11px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full border border-primary/20">
                            KYC Needed
                          </span>
                        )}
                      </div>
                      <div>
                        <div className="text-2xl font-extrabold text-foreground">No Limit</div>
                        <p className="text-xs font-semibold text-muted-foreground mt-0.5">Unlimited Trading & Withdrawals</p>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        <strong>KYC needed.</strong> Submit regional identification documents below to upgrade to Tier 2 for unlimited trading.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Submit Identification Documents (Regional Country with search + Permanent Save) */}
                <div className="bg-card border border-border rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
                  <div className="pb-3 border-b border-border flex items-center justify-between">
                    <div>
                      <h2 className="text-base font-bold text-foreground">
                        Submit Identification Documents
                      </h2>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Select your regional country with flags, enter document details, and upload scans. Once submitted, records are permanently saved and locked.
                      </p>
                    </div>
                    {isKycSubmitted && (
                      <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/20 flex items-center gap-1 shrink-0">
                        <Check className="w-3.5 h-3.5" /> Permanently Saved
                      </span>
                    )}
                  </div>

                  {isKycSubmitted ? (
                    <div className="p-5 rounded-xl bg-secondary/50 border border-border space-y-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                          <ShieldCheck className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-foreground">
                            KYC Documents Permanently Saved & Locked
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Your verification record is permanently encrypted and securely saved for Tier 2 limits. In accordance with compliance regulations, verified KYC details cannot be altered.
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-3 border-t border-border text-xs">
                        <div>
                          <span className="text-muted-foreground block font-semibold">Issuing Country</span>
                          <span className="font-bold text-foreground flex items-center gap-1.5 mt-0.5">
                            <span>{selectedCountryObj.flag}</span>
                            <span>{selectedCountryObj.name} ({selectedCountryObj.code})</span>
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block font-semibold">Document Type</span>
                          <span className="font-bold text-foreground block mt-0.5">
                            {KYC_DOC_TYPES.find((d) => d.id === kycDocType)?.label || kycDocType}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block font-semibold">Compliance Status</span>
                          <span className="font-bold text-primary block mt-0.5">
                            {kycStatus === 'VERIFIED' ? 'Verified' : 'Under Compliance Review'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <form onSubmit={handleSubmitKycPermanent} className="space-y-4 sm:space-y-5">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
                        {/* Regional Country Selection with Search & Flags */}
                        <div className="space-y-1.5 relative">
                          <label className="block text-xs font-semibold text-foreground">
                            Regional Country <span className="text-rose-500">*</span>
                          </label>
                          <button
                            type="button"
                            id="country-select-trigger"
                            onClick={() => {
                              setIsCountryModalOpen(!isCountryModalOpen);
                              setCountrySearchQuery('');
                            }}
                            className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border border-input bg-background text-sm text-left hover:border-primary transition-all cursor-pointer"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-base">{selectedCountryObj.flag}</span>
                              <span className="font-bold text-foreground">{selectedCountryObj.name}</span>
                              <span className="text-xs text-muted-foreground">({selectedCountryObj.code})</span>
                            </div>
                            <Search className="w-4 h-4 text-muted-foreground shrink-0 ml-2" />
                          </button>

                          {/* Searchable Countries Popup */}
                          {isCountryModalOpen && (
                            <div className="absolute z-40 left-0 right-0 top-full mt-1.5 bg-card border border-border rounded-2xl shadow-xl p-3 space-y-2 max-h-72 flex flex-col">
                              <div className="relative">
                                <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                                <input
                                  type="text"
                                  autoFocus
                                  placeholder="Search country by name or code..."
                                  value={countrySearchQuery}
                                  onChange={(e) => setCountrySearchQuery(e.target.value)}
                                  className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-input bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                                />
                              </div>
                              <div className="overflow-y-auto space-y-1 flex-1 pr-1">
                                {filteredCountries.map((c) => (
                                  <button
                                    key={c.code}
                                    type="button"
                                    onClick={() => {
                                      setKycCountry(c.code);
                                      setIsCountryModalOpen(false);
                                    }}
                                    className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs transition-colors cursor-pointer ${
                                      kycCountry === c.code
                                        ? 'bg-primary/10 text-primary font-bold'
                                        : 'hover:bg-muted/60 text-foreground'
                                    }`}
                                  >
                                    <div className="flex items-center gap-2 min-w-0">
                                      <span className="text-base">{c.flag}</span>
                                      <span className="font-medium truncate">{c.name}</span>
                                    </div>
                                    <span className="font-mono text-muted-foreground shrink-0">{c.code}</span>
                                  </button>
                                ))}
                                {filteredCountries.length === 0 && (
                                  <p className="text-xs text-muted-foreground text-center py-4">
                                    No countries found matching &quot;{countrySearchQuery}&quot;
                                  </p>
                                )}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Document Type */}
                        <div className="space-y-1.5">
                          <label className="block text-xs font-semibold text-foreground">
                            Document Type <span className="text-rose-500">*</span>
                          </label>
                          <select
                            id="select-kyc-doctype"
                            value={kycDocType}
                            onChange={(e) => setKycDocType(e.target.value)}
                            className="w-full px-3.5 py-2.5 rounded-xl border border-input bg-background text-sm focus:ring-2 focus:ring-primary focus:border-primary focus:outline-none cursor-pointer"
                          >
                            {KYC_DOC_TYPES.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Document ID Number */}
                        <div className="space-y-1.5">
                          <label className="block text-xs font-semibold text-foreground">
                            Document ID Number <span className="text-rose-500">*</span>
                          </label>
                          <input
                            type="text"
                            id="input-kyc-docnum"
                            value={kycDocNumber}
                            onChange={(e) => setKycDocNumber(e.target.value)}
                            placeholder="e.g. A12345678"
                            className="w-full px-3.5 py-2.5 rounded-xl border border-input bg-background text-sm focus:ring-2 focus:ring-primary focus:border-primary focus:outline-none"
                            required
                          />
                        </div>

                        {/* Residential Street Address */}
                        <div className="space-y-1.5">
                          <label className="block text-xs font-semibold text-foreground">
                            Residential Street Address <span className="text-rose-500">*</span>
                          </label>
                          <input
                            type="text"
                            id="input-kyc-street"
                            value={kycStreet}
                            onChange={(e) => setKycStreet(e.target.value)}
                            placeholder="Street address"
                            className="w-full px-3.5 py-2.5 rounded-xl border border-input bg-background text-sm focus:ring-2 focus:ring-primary focus:border-primary focus:outline-none"
                            required
                          />
                        </div>

                        {/* City */}
                        <div className="space-y-1.5">
                          <label className="block text-xs font-semibold text-foreground">
                            City <span className="text-rose-500">*</span>
                          </label>
                          <input
                            type="text"
                            id="input-kyc-city"
                            value={kycCity}
                            onChange={(e) => setKycCity(e.target.value)}
                            placeholder="City"
                            className="w-full px-3.5 py-2.5 rounded-xl border border-input bg-background text-sm focus:ring-2 focus:ring-primary focus:border-primary focus:outline-none"
                            required
                          />
                        </div>

                        {/* Postal / ZIP Code */}
                        <div className="space-y-1.5">
                          <label className="block text-xs font-semibold text-foreground">
                            Postal / ZIP Code
                          </label>
                          <input
                            type="text"
                            id="input-kyc-zip"
                            value={kycPostalCode}
                            onChange={(e) => setKycPostalCode(e.target.value)}
                            placeholder="Postal code"
                            className="w-full px-3.5 py-2.5 rounded-xl border border-input bg-background text-sm focus:ring-2 focus:ring-primary focus:border-primary focus:outline-none"
                          />
                        </div>
                      </div>

                      {/* File Upload Scans */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                        {/* Front Doc */}
                        <div className="p-4 rounded-xl border border-dashed border-border bg-secondary/30 space-y-2 text-center">
                          <input
                            type="file"
                            ref={frontDocInputRef}
                            onChange={handleFrontDocSelected}
                            accept="image/*,.pdf"
                            className="hidden"
                          />
                          <p className="text-xs font-bold text-foreground">
                            Front Side of Document <span className="text-rose-500">*</span>
                          </p>
                          {frontDocPreview ? (
                            <div className="relative mx-auto w-32 h-20 rounded-lg overflow-hidden border border-border">
                              <img src={frontDocPreview} alt="Front ID" className="w-full h-full object-cover" />
                            </div>
                          ) : (
                            <Upload className="w-6 h-6 text-primary mx-auto" />
                          )}
                          <p className="text-[11px] text-muted-foreground truncate">
                            {frontDocName || 'Front of ID or Passport'}
                          </p>
                          <button
                            type="button"
                            onClick={() => frontDocInputRef.current?.click()}
                            className="text-xs font-semibold px-3 py-1 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors cursor-pointer"
                          >
                            {frontDocName ? 'Change Front File' : 'Select Front File'}
                          </button>
                        </div>

                        {/* Back Doc */}
                        <div className="p-4 rounded-xl border border-dashed border-border bg-secondary/30 space-y-2 text-center">
                          <input
                            type="file"
                            ref={backDocInputRef}
                            onChange={handleBackDocSelected}
                            accept="image/*,.pdf"
                            className="hidden"
                          />
                          <p className="text-xs font-bold text-foreground">
                            Back Side / Address Proof
                          </p>
                          {backDocPreview ? (
                            <div className="relative mx-auto w-32 h-20 rounded-lg overflow-hidden border border-border">
                              <img src={backDocPreview} alt="Back ID" className="w-full h-full object-cover" />
                            </div>
                          ) : (
                            <Upload className="w-6 h-6 text-primary mx-auto" />
                          )}
                          <p className="text-[11px] text-muted-foreground truncate">
                            {backDocName || 'Back of card (optional for passport)'}
                          </p>
                          <button
                            type="button"
                            onClick={() => backDocInputRef.current?.click()}
                            className="text-xs font-semibold px-3 py-1 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors cursor-pointer"
                          >
                            {backDocName ? 'Change Back File' : 'Select Back File'}
                          </button>
                        </div>
                      </div>

                      {/* Permanent Save Notice */}
                      <div className="p-3.5 rounded-xl bg-primary/10 border border-primary/20 flex items-start gap-2.5 text-xs text-foreground">
                        <Info className="w-4 h-4 shrink-0 text-primary mt-0.5" />
                        <span>
                          <strong>Permanent Save Policy:</strong> After submitting your regional country and identification documents, this verification data is permanently saved and locked for your account compliance.
                        </span>
                      </div>

                      <div className="pt-2">
                        <button
                          type="submit"
                          id="submit-kyc-btn"
                          disabled={submittingKyc}
                          className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-xs disabled:opacity-50 cursor-pointer"
                        >
                          {submittingKyc ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <ShieldCheck className="w-4 h-4" />
                          )}
                          <span>Submit Identification Documents (Permanent Save)</span>
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
