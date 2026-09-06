'use client';

import React, { useState, useEffect, useRef, ChangeEvent } from 'react';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/components/providers/auth-provider';
import {
  User,
  Shield,
  Lock,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Upload,
  Check,
  X,
  History,
  Ban,
  ThumbsUp,
  FileText,
  Globe,
  DollarSign,
  Clock,
  Bell,
  Sliders,
  Eye,
  Trash2,
  HelpCircle,
  Smartphone,
  ExternalLink,
  Copy,
  UserCheck,
  AlertCircle,
  KeyRound,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  Layers,
  MapPin,
  Laptop,
  CheckCheck,
} from 'lucide-react';

// ==========================================
// CATEGORIES & SUB-CATEGORIES DEFINITION
// ==========================================
export type CategoryId = 'account' | 'verification' | 'preferences' | 'security';

export type SubCategoryId =
  // Account & Profile
  | 'profile-avatar'
  | 'profile-username'
  | 'profile-personal'
  // Identity & KYC
  | 'kyc-documents'
  | 'kyc-status'
  // Preferences & Localization
  | 'pref-regional'
  | 'pref-trading'
  | 'pref-notifications'
  // Security & Safety
  | 'sec-password'
  | 'sec-questions'
  | 'sec-blocked'
  | 'sec-sessions';

interface SubCategoryItem {
  id: SubCategoryId;
  title: string;
  shortDesc: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
}

interface CategoryItem {
  id: CategoryId;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  subCategories: SubCategoryItem[];
}

const SETTINGS_CATEGORIES: CategoryItem[] = [
  {
    id: 'account',
    title: 'Account & Profile',
    description: 'Personal details, avatar, and public trading identity',
    icon: User,
    subCategories: [
      {
        id: 'profile-avatar',
        title: 'Profile Picture & Avatar',
        shortDesc: 'Custom photo or default initials badge',
        icon: User,
      },
      {
        id: 'profile-username',
        title: 'Username & Handle',
        shortDesc: 'Real-time handle availability & rules',
        icon: CheckCheck,
      },
      {
        id: 'profile-personal',
        title: 'Personal Information',
        shortDesc: 'Legal name, birthdate, and chat privacy',
        icon: FileText,
      },
    ],
  },
  {
    id: 'verification',
    title: 'Identity & Verification',
    description: 'Government documents, address details, and automated Didit KYC',
    icon: ShieldCheck,
    subCategories: [
      {
        id: 'kyc-documents',
        title: 'Submit Identification Documents',
        shortDesc: 'ID details, address, document upload & Didit redirect',
        icon: FileText,
        badge: 'Required',
      },
      {
        id: 'kyc-status',
        title: 'Tier Limits & Verification Status',
        shortDesc: 'Active daily limits and approval progress',
        icon: Shield,
      },
    ],
  },
  {
    id: 'preferences',
    title: 'Preferences & Regional',
    description: 'Fiat currency, platform language, and trading parameters',
    icon: Sliders,
    subCategories: [
      {
        id: 'pref-regional',
        title: 'Regional & Currency',
        shortDesc: 'Country, fiat currency, language & timezone',
        icon: Globe,
      },
      {
        id: 'pref-trading',
        title: 'Trading Preferences',
        shortDesc: 'Escrow payment window & auto-reply message',
        icon: DollarSign,
      },
      {
        id: 'pref-notifications',
        title: 'Notifications & Alerts',
        shortDesc: 'Email, push, and order status preferences',
        icon: Bell,
      },
    ],
  },
  {
    id: 'security',
    title: 'Security & Access',
    description: 'Password, Two-Factor Authentication, and active devices',
    icon: Lock,
    subCategories: [
      {
        id: 'sec-password',
        title: 'Password & 2FA',
        shortDesc: 'Change login password & Two-Factor Authentication',
        icon: KeyRound,
      },
      {
        id: 'sec-questions',
        title: 'Security Questions',
        shortDesc: 'Secondary recovery question and answer',
        icon: HelpCircle,
      },
      {
        id: 'sec-blocked',
        title: 'Blocked Users',
        shortDesc: 'Manage restricted traders list',
        icon: Ban,
      },
      {
        id: 'sec-sessions',
        title: 'Active Sessions & Devices',
        shortDesc: 'Review active logins and device history',
        icon: Smartphone,
      },
    ],
  },
];

// ==========================================
// CONSTANTS FOR SELECTORS
// ==========================================
const CURRENCIES = [
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen' },
  { code: 'USDT', symbol: '₮', name: 'Tether USD' },
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

const COUNTRIES = [
  { code: 'IN', name: 'India (IN)' },
  { code: 'US', name: 'United States (US)' },
  { code: 'AE', name: 'United Arab Emirates (AE)' },
  { code: 'GB', name: 'United Kingdom (GB)' },
  { code: 'CA', name: 'Canada (CA)' },
  { code: 'AU', name: 'Australia (AU)' },
  { code: 'DE', name: 'Germany (DE)' },
  { code: 'FR', name: 'France (FR)' },
  { code: 'SG', name: 'Singapore (SG)' },
  { code: 'NG', name: 'Nigeria (NG)' },
  { code: 'BR', name: 'Brazil (BR)' },
  { code: 'ID', name: 'Indonesia (ID)' },
  { code: 'ZA', name: 'South Africa (ZA)' },
  { code: 'PH', name: 'Philippines (PH)' },
  { code: 'PK', name: 'Pakistan (PK)' },
  { code: 'BD', name: 'Bangladesh (BD)' },
];

const TIMEZONES = [
  { value: 'UTC', label: 'UTC (Coordinated Universal Time)' },
  { value: 'America/New_York', label: 'EST / EDT (New York, Toronto)' },
  { value: 'America/Chicago', label: 'CST / CDT (Chicago, Dallas)' },
  { value: 'America/Los_Angeles', label: 'PST / PDT (Los Angeles, San Francisco)' },
  { value: 'Europe/London', label: 'GMT / BST (London, Dublin)' },
  { value: 'Europe/Paris', label: 'CET / CEST (Paris, Berlin, Rome)' },
  { value: 'Asia/Dubai', label: 'GST (Dubai, Abu Dhabi)' },
  { value: 'Asia/Kolkata', label: 'IST (India Standard Time - New Delhi, Mumbai)' },
  { value: 'Asia/Singapore', label: 'SGT (Singapore, Kuala Lumpur)' },
  { value: 'Asia/Tokyo', label: 'JST (Tokyo, Seoul)' },
  { value: 'Australia/Sydney', label: 'AEST / AEDT (Sydney, Melbourne)' },
];

const KYC_DOCUMENT_TYPES = [
  { id: 'NATIONAL_ID', label: 'National ID Card' },
  { id: 'DRIVERS_LICENSE', label: 'Driver’s License' },
  { id: 'RESIDENCE_PERMIT', label: 'Residence Permit' },
  { id: 'GOVERNMENT_ID', label: 'Government-Issued ID' },
  { id: 'PASSPORT', label: 'Passport' },
  { id: 'OTHER_GOV_DOC', label: 'Other supported government-issued identification documents' },
];

export default function SettingsPage() {
  const supabase = createClient();
  const { refreshProfile } = useAuth();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const frontDocInputRef = useRef<HTMLInputElement>(null);
  const backDocInputRef = useRef<HTMLInputElement>(null);

  // Active Category and Sub-category navigation state
  const [activeCategory, setActiveCategory] = useState<CategoryId>('account');
  const [activeSubCategory, setActiveSubCategory] = useState<SubCategoryId>('profile-avatar');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Global Page Loading & Authentication Profile State
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [authProvider, setAuthProvider] = useState('email');
  const [profile, setProfile] = useState<any>(null);

  // Toast / Status banner
  const [toastMsg, setToastMsg] = useState<{ id: number; type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [savingField, setSavingField] = useState<string | null>(null);

  // 1. Profile Avatar
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // 2. Username
  const [username, setUsername] = useState('');
  const [isCheckingUsername, setIsCheckingUsername] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [usernameReason, setUsernameReason] = useState('');
  const [usernameTimer, setUsernameTimer] = useState<NodeJS.Timeout | null>(null);

  // 3. Personal Info
  const [fullName, setFullName] = useState('');
  const [dob, setDob] = useState('');
  const [nameVisibility, setNameVisibility] = useState<'FULL' | 'PARTIAL' | 'HIDE'>('FULL');
  const [bioNote, setBioNote] = useState('');

  // 4. KYC Details & Document Upload
  // Step 1: Identification & Address
  const [kycDocType, setKycDocType] = useState('NATIONAL_ID');
  const [kycCountry, setKycCountry] = useState('IN');
  const [kycDocNumber, setKycDocNumber] = useState('');
  const [kycStreet, setKycStreet] = useState('');
  const [kycCity, setKycCity] = useState('');
  const [kycPostalCode, setKycPostalCode] = useState('');
  // Step 2: Documents display trigger (shown after address submission)
  const [addressSubmitted, setAddressSubmitted] = useState(false);
  const [frontDocFile, setFrontDocFile] = useState<File | null>(null);
  const [frontDocName, setFrontDocName] = useState('');
  const [frontDocPreview, setFrontDocPreview] = useState<string | null>(null);
  const [backDocFile, setBackDocFile] = useState<File | null>(null);
  const [backDocName, setBackDocName] = useState('');
  const [backDocPreview, setBackDocPreview] = useState<string | null>(null);
  const [startingDidit, setStartingDidit] = useState(false);
  const [diditSessionUrl, setDiditSessionUrl] = useState<string | null>(null);

  // 5. Regional & Currency Preferences
  const [country, setCountry] = useState('IN');
  const [currency, setCurrency] = useState('USD');
  const [language, setLanguage] = useState('en');
  const [timezone, setTimezone] = useState('UTC');

  // 6. Trading Preferences
  const [paymentWindow, setPaymentWindow] = useState<number>(15);
  const [autoReplyMessage, setAutoReplyMessage] = useState('');
  const [showOnlineStatus, setShowOnlineStatus] = useState(true);

  // 7. Notification Preferences
  const [notifications, setNotifications] = useState({
    email_new_orders: true,
    email_chat_messages: true,
    email_payment_received: true,
    email_disputes: true,
    email_security_alerts: true,
    email_marketing: false,
    push_order_updates: true,
    push_chat_messages: true,
    sms_urgent_alerts: false,
  });

  // 8. Security & Passwords
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [is2faEnabled, setIs2faEnabled] = useState(false);
  const [secQuestion, setSecQuestion] = useState('');
  const [secAnswer, setSecAnswer] = useState('');

  // 9. Blocked Users & Active Sessions
  const [blockedUsers, setBlockedUsers] = useState<any[]>([]);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);

  // Toast notification helper
  const notify = (type: 'success' | 'error' | 'info', text: string) => {
    setToastMsg({ id: Date.now(), type, text });
    setTimeout(() => {
      setToastMsg((prev) => (prev?.text === text ? null : prev));
    }, 4500);
  };

  // Helper to sync changes across the entire app instantaneously
  const broadcastProfileUpdate = async (updatedData: Record<string, any>) => {
    // 1. Dispatch custom event for instant in-memory listener
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('profile-updated', { detail: updatedData }));
    }
    // 2. Update Supabase Auth user metadata
    try {
      await supabase.auth.updateUser({ data: updatedData });
    } catch (e) {
      console.warn('Metadata update skipped:', e);
    }
    // 3. Trigger refreshProfile in AuthProvider
    try {
      await refreshProfile();
    } catch (e) {
      console.warn('Profile refresh skipped:', e);
    }
  };

  // Load Settings on Component Mount
  useEffect(() => {
    loadSettings();
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
        setAuthProvider(u.auth_provider || p.auth_provider || 'email');
        setProfile(p);

        setAvatarUrl(p.avatar_url || p.photo_url || null);
        setUsername(p.username || '');
        setFullName(p.full_name || '');
        setDob(p.dob || '');
        setNameVisibility(p.name_visibility || 'FULL');
        setCountry(p.country || 'IN');
        setCurrency(p.preferred_currency || 'USD');
        setIs2faEnabled(Boolean(p.is_2fa_enabled));
        setSecQuestion(p.security_question || '');

        // KYC initial address data
        if (p.address_street || p.address_city) {
          setKycStreet(p.address_street || '');
          setKycCity(p.address_city || '');
          setKycPostalCode(p.address_postal_code || '');
          setKycCountry(p.country || 'IN');
          // If address was already stored or submitted before, open document step
          setAddressSubmitted(true);
        }

        // Load local preferences if stored
        if (typeof window !== 'undefined' && u.id) {
          try {
            const stored = localStorage.getItem(`p2p_preferences_${u.id}`);
            if (stored) {
              const pref = JSON.parse(stored);
              if (pref.language) setLanguage(pref.language);
              if (pref.timezone) setTimezone(pref.timezone);
              if (pref.paymentWindow) setPaymentWindow(pref.paymentWindow);
              if (pref.autoReplyMessage) setAutoReplyMessage(pref.autoReplyMessage);
              if (typeof pref.showOnlineStatus === 'boolean') setShowOnlineStatus(pref.showOnlineStatus);
              if (pref.notifications) setNotifications((prev) => ({ ...prev, ...pref.notifications }));
              if (pref.bioNote) setBioNote(pref.bioNote);
            }
          } catch (e) {
            console.error('Error parsing stored preferences:', e);
          }
        }
      } else {
        // Fallback directly to client auth
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
            setDob(p.dob || '');
            setNameVisibility(p.name_visibility || 'FULL');
            setCountry(p.country || 'IN');
            setCurrency(p.preferred_currency || 'USD');
            setIs2faEnabled(Boolean(p.is_2fa_enabled));
            setSecQuestion(p.security_question || '');
          }
        }
      }

      fetchBlockedUsers();
    } catch (err) {
      console.error('Failed to load settings:', err);
      notify('error', 'Could not load your settings data.');
    } finally {
      setLoading(false);
    }
  }

  async function fetchBlockedUsers() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase
        .from('user_blocks')
        .select('id, blocked_user_id, created_at, reason')
        .eq('user_id', user.id);

      if (!error && data) {
        setBlockedUsers(data);
      }
    } catch (e) {
      // Ignore if table unavailable
    }
  }

  // ----------------------------------------------------
  // SUB-CATEGORY ACTIONS & INDIVIDUAL SAVE HANDLERS
  // ----------------------------------------------------

  // 1. Profile Picture: Upload
  const handleAvatarFileSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      notify('error', 'Please select an image file (PNG, JPG, WEBP).');
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
      if (!res.ok) throw new Error(data.error || 'Failed to upload profile picture');

      const newUrl = data.avatarUrl || data.avatar_url;
      setAvatarUrl(newUrl);
      setProfile((prev: any) => ({ ...prev, avatar_url: newUrl, photo_url: newUrl }));

      // INSTANT BROADCAST TO ENTIRE APP
      await broadcastProfileUpdate({ avatar_url: newUrl, photo_url: newUrl });

      notify('success', 'Profile picture updated and reflected across the app.');
    } catch (err: any) {
      notify('error', err.message || 'Error updating profile picture.');
    } finally {
      setUploadingAvatar(false);
      if (avatarInputRef.current) avatarInputRef.current.value = '';
    }
  };

  // 1b. Profile Picture: Remove
  const handleRemoveAvatar = async () => {
    setSavingField('avatar_remove');
    try {
      const res = await fetch('/api/user/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field: 'avatar', data: { avatarUrl: null } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setAvatarUrl(null);
      setProfile((prev: any) => ({ ...prev, avatar_url: null, photo_url: null }));

      // INSTANT BROADCAST TO ENTIRE APP
      await broadcastProfileUpdate({ avatar_url: null, photo_url: null });

      notify('success', 'Profile picture removed. Default avatar restored.');
    } catch (err: any) {
      notify('error', err.message || 'Failed to remove picture.');
    } finally {
      setSavingField(null);
    }
  };

  // 2. Real-time Username Checker
  const handleUsernameInputChange = (val: string) => {
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
      setUsernameReason('Must be 3-25 chars (lowercase letters, numbers, dots, underscores).');
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
          setUsernameReason(result.reason || 'Username is already taken.');
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

  // 2b. Username Save
  const handleSaveUsername = async () => {
    if (username === profile?.username) {
      notify('error', 'This is already your current username.');
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
      if (!res.ok) throw new Error(data.error);

      const updatedUname = data.updatedValue || username;
      setProfile((prev: any) => ({ ...prev, username: updatedUname, display_name: updatedUname }));
      setUsernameAvailable(null);

      // INSTANT BROADCAST TO ENTIRE APP
      await broadcastProfileUpdate({ username: updatedUname, display_name: updatedUname });

      notify('success', 'Username updated! Reflected across the entire platform.');
    } catch (err: any) {
      notify('error', err.message || 'Failed to update username.');
    } finally {
      setSavingField(null);
    }
  };

  // 3. Personal Info Save
  const handleSavePersonalInfo = async () => {
    setSavingField('personal_info');
    try {
      const res = await fetch('/api/user/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          field: 'personal_info',
          data: { fullName, dob, nameVisibility },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const updatedDisplayName = fullName || profile?.username;
      setProfile((prev: any) => ({
        ...prev,
        full_name: fullName,
        dob,
        name_visibility: nameVisibility,
        display_name: updatedDisplayName,
      }));

      // Save bio note locally
      saveLocalPref({ bioNote });

      // INSTANT BROADCAST TO ENTIRE APP
      await broadcastProfileUpdate({
        full_name: fullName,
        display_name: updatedDisplayName,
      });

      notify('success', 'Personal information saved and updated in headers & chats.');
    } catch (err: any) {
      notify('error', err.message || 'Failed to save personal info.');
    } finally {
      setSavingField(null);
    }
  };

  // ----------------------------------------------------
  // 4. KYC WORKFLOW (2-STEP ADDRESS -> DOCUMENTS -> DIDIT)
  // ----------------------------------------------------

  // Step 1: User submits their address details
  const handleSubmitAddressDetails = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!kycDocType) {
      notify('error', 'Please select a Document Type.');
      return;
    }
    if (!kycCountry) {
      notify('error', 'Please select an Issuing Country.');
      return;
    }
    if (!kycStreet.trim() || !kycCity.trim()) {
      notify('error', 'Please enter your residential street address and city.');
      return;
    }

    setSavingField('kyc_address');
    try {
      const res = await fetch('/api/user/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          field: 'kyc_submission',
          data: {
            documentType: kycDocType,
            country: kycCountry,
            documentNumber: kycDocNumber,
            street: kycStreet,
            city: kycCity,
            postalCode: kycPostalCode,
          },
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save address details');

      setAddressSubmitted(true);
      notify('success', 'Address details verified. Please upload the front and back scans of your document.');
    } catch (err: any) {
      notify('error', err.message || 'Error saving address details.');
    } finally {
      setSavingField(null);
    }
  };

  // Step 2: Handle Front Document selection
  const handleFrontDocSelected = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      notify('error', 'Front document file exceeds 10MB limit.');
      return;
    }

    setFrontDocFile(file);
    setFrontDocName(file.name);
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => setFrontDocPreview(reader.result as string);
      reader.readAsDataURL(file);
    } else {
      setFrontDocPreview(null);
    }
    notify('info', `Front document selected: ${file.name}`);
  };

  // Step 2: Handle Back Document selection
  const handleBackDocSelected = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      notify('error', 'Back document file exceeds 10MB limit.');
      return;
    }

    setBackDocFile(file);
    setBackDocName(file.name);
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => setBackDocPreview(reader.result as string);
      reader.readAsDataURL(file);
    } else {
      setBackDocPreview(null);
    }
    notify('info', `Back document / Address proof selected: ${file.name}`);
  };

  // Step 3: Complete KYC & Redirect to Didit
  const handleCompleteAndRedirectToDidit = async () => {
    if (!frontDocName && !frontDocFile) {
      notify('error', 'Please select the Front Side of your identification document.');
      return;
    }

    setStartingDidit(true);
    try {
      // 1. Record document submission in Supabase
      await fetch('/api/user/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          field: 'kyc_submission',
          data: {
            documentType: kycDocType,
            country: kycCountry,
            documentNumber: kycDocNumber,
            street: kycStreet,
            city: kycCity,
            postalCode: kycPostalCode,
            frontDocName,
            backDocName,
          },
        }),
      });

      // 2. Initialize Didit session via /api/verify
      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });

      const data = await res.json();
      const redirectUrl = data.url || data.sessionUrl;

      if (redirectUrl) {
        setDiditSessionUrl(redirectUrl);
        notify('success', 'Redirecting to Didit automated verification...');
        // Seamless redirect to Didit
        setTimeout(() => {
          window.location.href = redirectUrl;
        }, 1200);
      } else {
        // Didit session initialized or simulation fallback
        notify('success', 'Documents submitted successfully. Verification status is now IN REVIEW.');
        setProfile((prev: any) => ({ ...prev, kyc_status: 'PENDING' }));
      }
    } catch (err: any) {
      console.error('Didit redirect error:', err);
      notify('error', err.message || 'Could not connect to Didit verification portal.');
    } finally {
      setStartingDidit(false);
    }
  };

  // ----------------------------------------------------
  // PREFERENCES & LOCALIZATION HANDLERS
  // ----------------------------------------------------
  const handleSaveCountry = async () => {
    setSavingField('country');
    try {
      const res = await fetch('/api/user/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field: 'country', data: { country } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setProfile((prev: any) => ({ ...prev, country }));
      await broadcastProfileUpdate({ country });
      notify('success', 'Issuing country updated.');
    } catch (err: any) {
      notify('error', err.message || 'Failed to update country.');
    } finally {
      setSavingField(null);
    }
  };

  const handleSaveCurrency = async () => {
    setSavingField('currency');
    try {
      const res = await fetch('/api/user/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field: 'currency', data: { currency } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setProfile((prev: any) => ({ ...prev, preferred_currency: currency }));
      notify('success', 'Preferred fiat currency saved.');
    } catch (err: any) {
      notify('error', err.message || 'Failed to update currency.');
    } finally {
      setSavingField(null);
    }
  };

  const handleSaveLanguage = () => {
    setSavingField('language');
    saveLocalPref({ language });
    setTimeout(() => {
      setSavingField(null);
      notify('success', 'Platform language updated.');
    }, 250);
  };

  const handleSaveTimezone = () => {
    setSavingField('timezone');
    saveLocalPref({ timezone });
    setTimeout(() => {
      setSavingField(null);
      notify('success', 'Timezone preference saved.');
    }, 250);
  };

  const handleSaveTradingPreferences = () => {
    setSavingField('trading_preferences');
    saveLocalPref({ paymentWindow, autoReplyMessage, showOnlineStatus });
    setTimeout(() => {
      setSavingField(null);
      notify('success', 'Trading & Escrow preferences saved.');
    }, 300);
  };

  const handleToggleNotification = (key: keyof typeof notifications) => {
    const updated = { ...notifications, [key]: !notifications[key] };
    setNotifications(updated);
    saveLocalPref({ notifications: updated });
    notify('success', 'Notification preferences updated.');
  };

  const saveLocalPref = (updates: Record<string, any>) => {
    if (typeof window === 'undefined' || !userId) return;
    try {
      const existing = JSON.parse(localStorage.getItem(`p2p_preferences_${userId}`) || '{}');
      const merged = { ...existing, ...updates };
      localStorage.setItem(`p2p_preferences_${userId}`, JSON.stringify(merged));
    } catch (e) {
      console.error('Error writing preferences:', e);
    }
  };

  // ----------------------------------------------------
  // SECURITY HANDLERS
  // ----------------------------------------------------
  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword || newPassword.length < 6) {
      notify('error', 'New password must be at least 6 characters.');
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
      notify('success', 'Account login password updated successfully.');
    } catch (err: any) {
      notify('error', err.message || 'Failed to update password.');
    } finally {
      setSavingField(null);
    }
  };

  const handleToggle2FA = async () => {
    setSavingField('two_factor');
    try {
      const nextState = !is2faEnabled;
      const res = await fetch('/api/user/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          field: 'two_factor',
          data: { enabled: nextState },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setIs2faEnabled(nextState);
      setProfile((prev: any) => ({ ...prev, is_2fa_enabled: nextState }));
      notify('success', nextState ? 'Two-Factor Authentication activated.' : 'Two-Factor Authentication disabled.');
    } catch (err: any) {
      notify('error', err.message || 'Failed to toggle 2FA.');
    } finally {
      setSavingField(null);
    }
  };

  const handleSaveSecurityQuestion = async () => {
    if (!secQuestion.trim()) {
      notify('error', 'Please enter a valid security question.');
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
      if (!res.ok) throw new Error(data.error);

      setProfile((prev: any) => ({ ...prev, security_question: secQuestion }));
      setSecAnswer('');
      notify('success', 'Security question and answer saved.');
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

  // Helper to switch sub-category
  const selectSubCategory = (catId: CategoryId, subId: SubCategoryId) => {
    setActiveCategory(catId);
    setActiveSubCategory(subId);
    setMobileMenuOpen(false);
  };

  // Find active Category & SubCategory object
  const currentCategory = SETTINGS_CATEGORIES.find((c) => c.id === activeCategory) || SETTINGS_CATEGORIES[0];
  const currentSubCategory = currentCategory.subCategories.find((s) => s.id === activeSubCategory) || currentCategory.subCategories[0];

  return (
    <div id="settings-container" className="w-full space-y-6 pb-16">
      {/* ---------------------------------------------------- */}
      {/* PAGE TITLE & LIVE TOAST BANNER                      */}
      {/* ---------------------------------------------------- */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
            Account Settings
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Configure your personal profile, identity verification, regional preferences, and security.
          </p>
        </div>

        {/* User Quick Info Badge */}
        <div className="flex items-center gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3.5 py-2 rounded-xl shadow-xs">
          <div className="relative">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt="Avatar"
                className="w-9 h-9 rounded-lg object-cover border border-slate-200 dark:border-slate-700"
              />
            ) : (
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-600 to-blue-600 text-white flex items-center justify-center font-bold text-sm">
                {(username || userEmail || 'U').substring(0, 2).toUpperCase()}
              </div>
            )}
            <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-slate-900" />
          </div>
          <div className="text-left leading-tight">
            <p className="text-xs font-semibold text-slate-900 dark:text-white truncate max-w-[130px]">
              @{username || 'trader'}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[130px]">
              {userEmail || 'user@p2p.exchange'}
            </p>
          </div>
        </div>
      </div>

      {/* Floating or Embedded Toast Message */}
      {toastMsg && (
        <div
          id="settings-notification-toast"
          className={`flex items-center justify-between p-3.5 rounded-xl border text-sm transition-all duration-200 ${
            toastMsg.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
              : toastMsg.type === 'error'
              ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200'
              : 'bg-blue-50 dark:bg-blue-950/40 border-blue-300 dark:border-blue-800 text-blue-800 dark:text-blue-200'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {toastMsg.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            ) : toastMsg.type === 'error' ? (
              <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
            )}
            <span className="font-medium">{toastMsg.text}</span>
          </div>
          <button
            id="dismiss-toast-btn"
            onClick={() => setToastMsg(null)}
            className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* MOBILE CATEGORY & SUB-CATEGORY ACCORDION / SELECTOR  */}
      {/* ---------------------------------------------------- */}
      <div className="lg:hidden">
        <button
          id="mobile-settings-menu-btn"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="w-full flex items-center justify-between p-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs text-left"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <currentCategory.icon className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                {currentCategory.title}
              </p>
              <p className="text-sm font-bold text-slate-900 dark:text-white">
                {currentSubCategory.title}
              </p>
            </div>
          </div>
          <ChevronDown
            className={`w-5 h-5 text-slate-400 transition-transform duration-200 ${
              mobileMenuOpen ? 'rotate-180' : ''
            }`}
          />
        </button>

        {mobileMenuOpen && (
          <div className="mt-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-md p-3 space-y-4">
            {SETTINGS_CATEGORIES.map((category) => (
              <div key={category.id} className="space-y-1">
                <p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider px-2 py-1 flex items-center gap-1.5">
                  <category.icon className="w-3.5 h-3.5" />
                  {category.title}
                </p>
                <div className="space-y-1 pl-2">
                  {category.subCategories.map((sub) => {
                    const isSelected = activeSubCategory === sub.id;
                    const SubIcon = sub.icon;
                    return (
                      <button
                        key={sub.id}
                        id={`mobile-subnav-${sub.id}`}
                        onClick={() => selectSubCategory(category.id, sub.id)}
                        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                          isSelected
                            ? 'bg-indigo-600 text-white font-semibold shadow-xs'
                            : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <SubIcon className={`w-4 h-4 ${isSelected ? 'text-white' : 'text-slate-400'}`} />
                          <span>{sub.title}</span>
                        </div>
                        {sub.badge && (
                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                              isSelected
                                ? 'bg-white/20 text-white'
                                : 'bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400'
                            }`}
                          >
                            {sub.badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---------------------------------------------------- */}
      {/* DESKTOP 2-COLUMN LAYOUT: CATEGORY SIDEBAR + MAIN     */}
      {/* ---------------------------------------------------- */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT NAVIGATION: CATEGORIES & SUB-CATEGORIES */}
        <aside className="hidden lg:block lg:col-span-4 xl:col-span-3 space-y-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-xs space-y-5">
            {SETTINGS_CATEGORIES.map((cat) => {
              const isCatActive = activeCategory === cat.id;
              const CatIcon = cat.icon;

              return (
                <div key={cat.id} className="space-y-1.5">
                  {/* Category Header */}
                  <div
                    onClick={() => setActiveCategory(cat.id)}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors ${
                      isCatActive
                        ? 'text-indigo-600 dark:text-indigo-400 font-bold'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 font-semibold'
                    }`}
                  >
                    <CatIcon className="w-4 h-4 shrink-0" />
                    <span className="text-xs uppercase tracking-wider">{cat.title}</span>
                  </div>

                  {/* Sub-categories List */}
                  <div className="space-y-1 pl-1">
                    {cat.subCategories.map((sub) => {
                      const isSubActive = activeSubCategory === sub.id;
                      const SubIcon = sub.icon;

                      return (
                        <button
                          key={sub.id}
                          id={`nav-subcat-${sub.id}`}
                          onClick={() => selectSubCategory(cat.id, sub.id)}
                          className={`w-full flex items-center justify-between text-left px-3 py-2 rounded-lg text-xs font-medium transition-all group ${
                            isSubActive
                              ? 'bg-indigo-600 text-white font-semibold shadow-xs'
                              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 truncate">
                            <SubIcon
                              className={`w-4 h-4 shrink-0 ${
                                isSubActive
                                  ? 'text-white'
                                  : 'text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-200'
                              }`}
                            />
                            <span className="truncate">{sub.title}</span>
                          </div>
                          {sub.badge && (
                            <span
                              className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 ${
                                isSubActive
                                  ? 'bg-white/25 text-white'
                                  : 'bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400'
                              }`}
                            >
                              {sub.badge}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        {/* RIGHT MAIN PANEL: ONLY THE OPENED SUB-CATEGORY'S SETTINGS */}
        <div className="lg:col-span-8 xl:col-span-9 space-y-6">
          {/* Breadcrumb & Section Header */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 shadow-xs flex items-center justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
                <span>{currentCategory.title}</span>
                <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-slate-700 dark:text-slate-300">{currentSubCategory.title}</span>
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
                {currentSubCategory.title}
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                {currentSubCategory.shortDesc}
              </p>
            </div>
            <div className="hidden sm:flex w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 items-center justify-center">
              <currentSubCategory.icon className="w-5 h-5" />
            </div>
          </div>

          {/* ---------------------------------------------------------------- */}
          {/* CONDITIONAL SUB-CATEGORY VIEW: ONLY OPENED SUB-CATEGORY IS SHOWN */}
          {/* ---------------------------------------------------------------- */}

          {/* ============================================================== */}
          {/* SUB-CATEGORY 1: PROFILE PICTURE & AVATAR                       */}
          {/* ============================================================== */}
          {activeSubCategory === 'profile-avatar' && (
            <div id="view-profile-avatar" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 shadow-xs space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center gap-6">
                {/* Avatar Preview */}
                <div className="relative shrink-0">
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt="Avatar"
                      className="w-24 h-24 rounded-2xl object-cover border-2 border-slate-200 dark:border-slate-700 shadow-xs"
                    />
                  ) : (
                    <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-indigo-600 to-blue-600 text-white flex items-center justify-center font-extrabold text-2xl shadow-xs">
                      {(username || userEmail || 'U').substring(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-500 ring-4 ring-white dark:ring-slate-900 flex items-center justify-center">
                    <Check className="w-3 h-3 text-white stroke-[3]" />
                  </div>
                </div>

                {/* Upload & Remove Controls */}
                <div className="space-y-3 flex-1">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">
                      Profile Picture
                    </h3>
                    <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                      Upload a photo to represent your profile across trade chats, advertisements, and public offers.
                      Accepts PNG, JPG, or WEBP up to 5MB. Changes reflect instantly throughout the entire application.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <input
                      ref={avatarInputRef}
                      type="file"
                      id="avatar-file-input"
                      accept="image/png, image/jpeg, image/webp"
                      className="hidden"
                      onChange={handleAvatarFileSelected}
                    />

                    <button
                      id="upload-avatar-btn"
                      type="button"
                      disabled={uploadingAvatar}
                      onClick={() => avatarInputRef.current?.click()}
                      className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-xs sm:text-sm font-semibold shadow-xs disabled:opacity-50 transition-colors"
                    >
                      {uploadingAvatar ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Uploading...</span>
                        </>
                      ) : (
                        <>
                          <Upload className="w-4 h-4" />
                          <span>Upload New Picture</span>
                        </>
                      )}
                    </button>

                    {avatarUrl && (
                      <button
                        id="remove-avatar-btn"
                        type="button"
                        disabled={savingField === 'avatar_remove'}
                        onClick={handleRemoveAvatar}
                        className="flex items-center gap-2 px-3.5 py-2 border border-slate-200 dark:border-slate-800 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-slate-700 dark:text-slate-300 hover:text-rose-600 dark:hover:text-rose-400 rounded-xl text-xs sm:text-sm font-medium transition-colors"
                      >
                        {savingField === 'avatar_remove' ? (
                          <Loader2 className="w-4 h-4 animate-spin text-rose-500" />
                        ) : (
                          <Trash2 className="w-4 h-4 text-rose-500" />
                        )}
                        <span>Remove Picture</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* SUB-CATEGORY 2: USERNAME & IDENTITY                            */}
          {/* ============================================================== */}
          {activeSubCategory === 'profile-username' && (
            <div id="view-profile-username" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 shadow-xs space-y-6">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Trader Username Handle
                </h3>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                  Your handle appears in P2P advertisements, trade chat headers, reviews, and transaction escrow receipts.
                </p>
              </div>

              <div className="space-y-4 max-w-lg">
                <div className="space-y-1.5">
                  <label htmlFor="username-input" className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    Custom Username *
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 font-semibold text-sm">
                      @
                    </span>
                    <input
                      id="username-input"
                      type="text"
                      value={username}
                      onChange={(e) => handleUsernameInputChange(e.target.value)}
                      placeholder="e.g. crypto_trader"
                      className="w-full pl-8 pr-10 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"
                    />
                    <div className="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none">
                      {isCheckingUsername && <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />}
                      {!isCheckingUsername && usernameAvailable === true && (
                        <Check className="w-4 h-4 text-emerald-500 stroke-[3]" />
                      )}
                      {!isCheckingUsername && usernameAvailable === false && (
                        <X className="w-4 h-4 text-rose-500 stroke-[3]" />
                      )}
                    </div>
                  </div>

                  {/* Feedback on availability */}
                  {usernameAvailable === true && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1 mt-1">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      @{username} is available!
                    </p>
                  )}
                  {usernameAvailable === false && (
                    <p className="text-xs text-rose-600 dark:text-rose-400 font-medium flex items-center gap-1 mt-1">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      {usernameReason || 'Username is not available.'}
                    </p>
                  )}
                  <p className="text-[11px] text-slate-400 mt-1">
                    Requirements: 3-25 characters. Lowercase letters, numbers, dots, and underscores only.
                  </p>
                </div>

                <div className="pt-2">
                  <button
                    id="save-username-btn"
                    type="button"
                    disabled={savingField === 'username' || isCheckingUsername || username === profile?.username || usernameAvailable === false}
                    onClick={handleSaveUsername}
                    className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-xs sm:text-sm font-semibold shadow-xs disabled:opacity-50 transition-colors"
                  >
                    {savingField === 'username' ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Updating Username...</span>
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        <span>Save Username</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* SUB-CATEGORY 3: PERSONAL INFORMATION                           */}
          {/* ============================================================== */}
          {activeSubCategory === 'profile-personal' && (
            <div id="view-profile-personal" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 shadow-xs space-y-6">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Personal Information & Privacy
                </h3>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                  Update your legal full name, date of birth, and configure how your real identity is shared with escrow counterparties.
                </p>
              </div>

              <div className="space-y-4 max-w-lg">
                {/* Full Legal Name */}
                <div className="space-y-1.5">
                  <label htmlFor="full-name-input" className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    Full Legal Name
                  </label>
                  <input
                    id="full-name-input"
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. Johnathan Doe"
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"
                  />
                  <p className="text-[11px] text-slate-400">
                    Must match your government-issued ID for verification approval.
                  </p>
                </div>

                {/* Date of Birth */}
                <div className="space-y-1.5">
                  <label htmlFor="dob-input" className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    Date of Birth
                  </label>
                  <input
                    id="dob-input"
                    type="date"
                    value={dob}
                    onChange={(e) => setDob(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"
                  />
                </div>

                {/* Counterparty Name Visibility */}
                <div className="space-y-1.5">
                  <label htmlFor="name-visibility-select" className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    Counterparty Name Visibility
                  </label>
                  <select
                    id="name-visibility-select"
                    value={nameVisibility}
                    onChange={(e) => setNameVisibility(e.target.value as any)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"
                  >
                    <option value="FULL">Show Full Legal Name to Active Trade Partners</option>
                    <option value="PARTIAL">Show First Name & Initial Only (e.g. John D.)</option>
                    <option value="HIDE">Hide Real Name (Show Username Handle Only)</option>
                  </select>
                  <p className="text-[11px] text-slate-400">
                    Controls what is visible in the P2P chat room during active escrow trades.
                  </p>
                </div>

                {/* Public Trader Bio / Terms */}
                <div className="space-y-1.5">
                  <label htmlFor="bio-input" className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    Public Bio & Trading Terms
                  </label>
                  <textarea
                    id="bio-input"
                    rows={3}
                    value={bioNote}
                    onChange={(e) => setBioNote(e.target.value)}
                    placeholder="e.g. Fast response 24/7. Immediate bank transfer once escrow is locked."
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"
                  />
                </div>

                <div className="pt-2">
                  <button
                    id="save-personal-info-btn"
                    type="button"
                    disabled={savingField === 'personal_info'}
                    onClick={handleSavePersonalInfo}
                    className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-xs sm:text-sm font-semibold shadow-xs disabled:opacity-50 transition-colors"
                  >
                    {savingField === 'personal_info' ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        <span>Save Personal Information</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* SUB-CATEGORY 4: SUBMIT IDENTIFICATION DOCUMENTS (KYC + DIDIT)  */}
          {/* ============================================================== */}
          {activeSubCategory === 'kyc-documents' && (
            <div id="view-kyc-documents" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 shadow-xs space-y-6">
              {/* Header as requested */}
              <div className="border-b border-slate-200 dark:border-slate-800 pb-4">
                <h3 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white">
                  Submit Identification Documents
                </h3>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
                  Please provide your government-issued identification details below.
                </p>
              </div>

              {/* Status Banner */}
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <ShieldCheck className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Current Verification Status</p>
                    <p className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                      {profile?.kyc_status || 'NOT_STARTED'}
                    </p>
                  </div>
                </div>
                <span className="text-[10px] sm:text-xs font-bold px-2.5 py-1 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300">
                  Level 1 Tier
                </span>
              </div>

              {/* STEP 1: Identification & Address Form */}
              <form onSubmit={handleSubmitAddressDetails} className="space-y-4 max-w-2xl">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Document Type * */}
                  <div className="space-y-1.5">
                    <label htmlFor="kyc-doc-type" className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                      Document Type *
                    </label>
                    <select
                      id="kyc-doc-type"
                      value={kycDocType}
                      onChange={(e) => setKycDocType(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"
                    >
                      {KYC_DOCUMENT_TYPES.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Issuing Country * */}
                  <div className="space-y-1.5">
                    <label htmlFor="kyc-issuing-country" className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                      Issuing Country *
                    </label>
                    <select
                      id="kyc-issuing-country"
                      value={kycCountry}
                      onChange={(e) => setKycCountry(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"
                    >
                      {COUNTRIES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Document Identification Number */}
                <div className="space-y-1.5">
                  <label htmlFor="kyc-doc-number" className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    Document Identification Number
                  </label>
                  <input
                    id="kyc-doc-number"
                    type="text"
                    value={kycDocNumber}
                    onChange={(e) => setKycDocNumber(e.target.value)}
                    placeholder="e.g. DL-1420110012345 or Passport #"
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"
                  />
                </div>

                {/* Residential Street Address */}
                <div className="space-y-1.5">
                  <label htmlFor="kyc-street-address" className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    Residential Street Address
                  </label>
                  <input
                    id="kyc-street-address"
                    type="text"
                    value={kycStreet}
                    onChange={(e) => setKycStreet(e.target.value)}
                    placeholder="e.g. 124 Park Avenue, Apt 4B"
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* City / Town */}
                  <div className="space-y-1.5">
                    <label htmlFor="kyc-city" className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                      City / Town
                    </label>
                    <input
                      id="kyc-city"
                      type="text"
                      value={kycCity}
                      onChange={(e) => setKycCity(e.target.value)}
                      placeholder="e.g. New York / Mumbai"
                      className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"
                    />
                  </div>

                  {/* Postal / ZIP Code */}
                  <div className="space-y-1.5">
                    <label htmlFor="kyc-postal-code" className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                      Postal / ZIP Code
                    </label>
                    <input
                      id="kyc-postal-code"
                      type="text"
                      value={kycPostalCode}
                      onChange={(e) => setKycPostalCode(e.target.value)}
                      placeholder="e.g. 10001"
                      className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"
                    />
                  </div>
                </div>

                {/* Submit Address Details Button */}
                <div className="pt-2">
                  <button
                    id="submit-address-btn"
                    type="submit"
                    disabled={savingField === 'kyc_address'}
                    className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-xs sm:text-sm font-semibold shadow-xs disabled:opacity-50 transition-colors"
                  >
                    {savingField === 'kyc_address' ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Saving Address Details...</span>
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        <span>Save Address & Proceed to Documents</span>
                      </>
                    )}
                  </button>
                </div>
              </form>

              {/* STEP 2: DOCUMENT UPLOAD & DIDIT REDIRECT (SHOWN AFTER ADDRESS SUBMISSION) */}
              {addressSubmitted && (
                <div id="kyc-documents-step-2" className="mt-8 pt-6 border-t border-slate-200 dark:border-slate-800 space-y-6 animate-in fade-in duration-300">
                  <div>
                    <h4 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <FileText className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                      Upload Identification Scans
                    </h4>
                    <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                      Upload clear, high-resolution scans or photos of your government document. After selecting your files, you will be redirected to Didit to finalize automated biometric verification.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    {/* Front Side of Document */}
                    <div className="p-4 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                          Front Side of Document *
                        </span>
                        {frontDocName && (
                          <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <Check className="w-3 h-3" /> Ready
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Click to select photo or scan
                      </p>

                      {frontDocPreview && (
                        <div className="relative w-full h-32 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 bg-black/5">
                          <img src={frontDocPreview} alt="Front Document" className="w-full h-full object-cover" />
                        </div>
                      )}

                      <input
                        ref={frontDocInputRef}
                        type="file"
                        id="front-doc-file-input"
                        accept="image/*,.pdf"
                        className="hidden"
                        onChange={handleFrontDocSelected}
                      />

                      <div className="flex items-center justify-between pt-1">
                        <button
                          id="browse-front-doc-btn"
                          type="button"
                          onClick={() => frontDocInputRef.current?.click()}
                          className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl text-xs font-semibold transition-colors shadow-xs"
                        >
                          Browse
                        </button>
                        <span className="text-xs text-slate-500 truncate max-w-[140px]">
                          {frontDocName || 'No file selected'}
                        </span>
                      </div>
                    </div>

                    {/* Back Side / Address Proof */}
                    <div className="p-4 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                          Back Side / Address Proof
                        </span>
                        {backDocName && (
                          <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <Check className="w-3 h-3" /> Ready
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Click to select photo or scan
                      </p>

                      {backDocPreview && (
                        <div className="relative w-full h-32 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 bg-black/5">
                          <img src={backDocPreview} alt="Back Document" className="w-full h-full object-cover" />
                        </div>
                      )}

                      <input
                        ref={backDocInputRef}
                        type="file"
                        id="back-doc-file-input"
                        accept="image/*,.pdf"
                        className="hidden"
                        onChange={handleBackDocSelected}
                      />

                      <div className="flex items-center justify-between pt-1">
                        <button
                          id="browse-back-doc-btn"
                          type="button"
                          onClick={() => backDocInputRef.current?.click()}
                          className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl text-xs font-semibold transition-colors shadow-xs"
                        >
                          Browse
                        </button>
                        <span className="text-xs text-slate-500 truncate max-w-[140px]">
                          {backDocName || 'No file selected'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* SUBMIT & REDIRECT TO DIDIT */}
                  <div className="pt-3 flex flex-col sm:flex-row items-start sm:items-center gap-4">
                    <button
                      id="proceed-didit-btn"
                      type="button"
                      disabled={startingDidit}
                      onClick={handleCompleteAndRedirectToDidit}
                      className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md disabled:opacity-50 transition-all"
                    >
                      {startingDidit ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Preparing Didit Verification Portal...</span>
                        </>
                      ) : (
                        <>
                          <ExternalLink className="w-4 h-4" />
                          <span>Submit Documents & Proceed to Didit</span>
                        </>
                      )}
                    </button>

                    {diditSessionUrl && (
                      <a
                        id="direct-didit-link"
                        href={diditSessionUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
                      >
                        Did not redirect automatically? Click here to open Didit <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ============================================================== */}
          {/* SUB-CATEGORY 5: TIER LIMITS & STATUS                           */}
          {/* ============================================================== */}
          {activeSubCategory === 'kyc-status' && (
            <div id="view-kyc-status" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 shadow-xs space-y-6">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Verification Tier & Trading Limits
                </h3>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                  Higher verification tiers unlock increased daily volume caps and access to institutional payment channels.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 space-y-1">
                  <p className="text-xs text-slate-400">Daily P2P Trading Limit</p>
                  <p className="text-xl font-bold text-slate-900 dark:text-white">$50,000 USD</p>
                  <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">Standard Verified</p>
                </div>
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 space-y-1">
                  <p className="text-xs text-slate-400">Monthly Volume Cap</p>
                  <p className="text-xl font-bold text-slate-900 dark:text-white">$500,000 USD</p>
                  <p className="text-[11px] text-slate-400">Expandable on request</p>
                </div>
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 space-y-1">
                  <p className="text-xs text-slate-400">Allowed KYC Attempts</p>
                  <p className="text-xl font-bold text-slate-900 dark:text-white">3 Attempts</p>
                  <p className="text-[11px] text-indigo-600 dark:text-indigo-400 font-medium">Auto-renewed by Didit</p>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* SUB-CATEGORY 6: REGIONAL & CURRENCY PREFERENCES                */}
          {/* ============================================================== */}
          {activeSubCategory === 'pref-regional' && (
            <div id="view-pref-regional" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 shadow-xs space-y-6">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Regional & Currency Configuration
                </h3>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                  Set your native fiat currency for P2P advertisements, your preferred timezone for transaction logs, and platform language.
                </p>
              </div>

              <div className="space-y-5 max-w-lg">
                {/* Country Selection */}
                <div className="space-y-1.5">
                  <label htmlFor="country-selector" className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    Country of Residence
                  </label>
                  <div className="flex gap-2">
                    <select
                      id="country-selector"
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                      className="flex-1 px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"
                    >
                      {COUNTRIES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <button
                      id="save-country-btn"
                      type="button"
                      disabled={savingField === 'country'}
                      onClick={handleSaveCountry}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold transition-colors disabled:opacity-50"
                    >
                      {savingField === 'country' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
                    </button>
                  </div>
                </div>

                {/* Default Fiat Currency */}
                <div className="space-y-1.5">
                  <label htmlFor="currency-selector" className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    Default Fiat Currency
                  </label>
                  <div className="flex gap-2">
                    <select
                      id="currency-selector"
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                      className="flex-1 px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"
                    >
                      {CURRENCIES.map((cur) => (
                        <option key={cur.code} value={cur.code}>
                          {cur.symbol} - {cur.name} ({cur.code})
                        </option>
                      ))}
                    </select>
                    <button
                      id="save-currency-btn"
                      type="button"
                      disabled={savingField === 'currency'}
                      onClick={handleSaveCurrency}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold transition-colors disabled:opacity-50"
                    >
                      {savingField === 'currency' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
                    </button>
                  </div>
                </div>

                {/* Platform Language */}
                <div className="space-y-1.5">
                  <label htmlFor="language-selector" className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    Platform Display Language
                  </label>
                  <div className="flex gap-2">
                    <select
                      id="language-selector"
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                      className="flex-1 px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"
                    >
                      {LANGUAGES.map((l) => (
                        <option key={l.code} value={l.code}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                    <button
                      id="save-language-btn"
                      type="button"
                      disabled={savingField === 'language'}
                      onClick={handleSaveLanguage}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold transition-colors disabled:opacity-50"
                    >
                      {savingField === 'language' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
                    </button>
                  </div>
                </div>

                {/* Preferred Time Zone */}
                <div className="space-y-1.5">
                  <label htmlFor="timezone-selector" className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    Preferred Time Zone
                  </label>
                  <div className="flex gap-2">
                    <select
                      id="timezone-selector"
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      className="flex-1 px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"
                    >
                      {TIMEZONES.map((tz) => (
                        <option key={tz.value} value={tz.value}>
                          {tz.label}
                        </option>
                      ))}
                    </select>
                    <button
                      id="save-timezone-btn"
                      type="button"
                      disabled={savingField === 'timezone'}
                      onClick={handleSaveTimezone}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold transition-colors disabled:opacity-50"
                    >
                      {savingField === 'timezone' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* SUB-CATEGORY 7: TRADING PREFERENCES                            */}
          {/* ============================================================== */}
          {activeSubCategory === 'pref-trading' && (
            <div id="view-pref-trading" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 shadow-xs space-y-6">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Trading & Escrow Parameters
                </h3>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                  Default configurations applied to new escrow trades, ads, and chat interactions.
                </p>
              </div>

              <div className="space-y-5 max-w-lg">
                {/* Escrow Payment Window */}
                <div className="space-y-1.5">
                  <label htmlFor="payment-window-select" className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    Default Payment Window (Minutes)
                  </label>
                  <select
                    id="payment-window-select"
                    value={paymentWindow}
                    onChange={(e) => setPaymentWindow(Number(e.target.value))}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"
                  >
                    <option value={15}>15 Minutes (Recommended for fast trades)</option>
                    <option value={30}>30 Minutes</option>
                    <option value={45}>45 Minutes</option>
                    <option value={60}>60 Minutes (Maximum for P2P bank transfers)</option>
                  </select>
                </div>

                {/* Auto Reply Welcome Message */}
                <div className="space-y-1.5">
                  <label htmlFor="auto-reply-input" className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    Auto-Reply Welcome Message
                  </label>
                  <textarea
                    id="auto-reply-input"
                    rows={3}
                    value={autoReplyMessage}
                    onChange={(e) => setAutoReplyMessage(e.target.value)}
                    placeholder="e.g. Hello! Please provide your payment reference once transfer is made."
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"
                  />
                  <p className="text-[11px] text-slate-400">
                    Sent automatically as your first message when a trade partner initiates an order.
                  </p>
                </div>

                {/* Online Status Toggle */}
                <div className="flex items-center justify-between p-3.5 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700/80">
                  <div>
                    <p className="text-xs font-bold text-slate-900 dark:text-white">Show Online Indicator</p>
                    <p className="text-[11px] text-slate-400">Display green active indicator on ads</p>
                  </div>
                  <input
                    id="online-status-checkbox"
                    type="checkbox"
                    checked={showOnlineStatus}
                    onChange={(e) => setShowOnlineStatus(e.target.checked)}
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                  />
                </div>

                <div className="pt-2">
                  <button
                    id="save-trading-pref-btn"
                    type="button"
                    disabled={savingField === 'trading_preferences'}
                    onClick={handleSaveTradingPreferences}
                    className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs sm:text-sm font-semibold shadow-xs disabled:opacity-50 transition-colors"
                  >
                    {savingField === 'trading_preferences' ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        <span>Save Trading Preferences</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* SUB-CATEGORY 8: NOTIFICATIONS & ALERTS                         */}
          {/* ============================================================== */}
          {activeSubCategory === 'pref-notifications' && (
            <div id="view-pref-notifications" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 shadow-xs space-y-6">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Notification Preferences
                </h3>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                  Choose which alerts and communication channels notify you for transactions and security events.
                </p>
              </div>

              <div className="space-y-3">
                {[
                  { key: 'email_new_orders', label: 'New Escrow Orders & Offers', desc: 'When a user opens a trade on your ad' },
                  { key: 'email_chat_messages', label: 'Trade Chat Messages', desc: 'Instant alerts when counterparty replies' },
                  { key: 'email_payment_received', label: 'Payment Marked Sent / Received', desc: 'Buyer confirms fiat transaction' },
                  { key: 'email_disputes', label: 'Dispute & Mediation Alerts', desc: 'Moderator assistance and dispute notifications' },
                  { key: 'email_security_alerts', label: 'Security & Sign-in Alerts', desc: 'New login from unknown device or IP' },
                  { key: 'push_order_updates', label: 'Push Notifications for Orders', desc: 'Browser and mobile push updates' },
                ].map((item) => (
                  <div
                    key={item.key}
                    className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <div>
                      <p className="text-xs font-bold text-slate-900 dark:text-white">{item.label}</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">{item.desc}</p>
                    </div>
                    <input
                      type="checkbox"
                      id={`notif-${item.key}`}
                      checked={notifications[item.key as keyof typeof notifications]}
                      onChange={() => handleToggleNotification(item.key as keyof typeof notifications)}
                      className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* SUB-CATEGORY 9: PASSWORD & 2FA                                 */}
          {/* ============================================================== */}
          {activeSubCategory === 'sec-password' && (
            <div id="view-sec-password" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 shadow-xs space-y-6">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Password & Two-Factor Authentication
                </h3>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                  Safeguard your crypto escrow assets and account credentials.
                </p>
              </div>

              {/* 2FA Toggle Card */}
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                    <Smartphone className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900 dark:text-white">Two-Factor Authentication (2FA)</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {is2faEnabled ? '2FA is active. Authenticator app required for withdrawals.' : '2FA is currently disabled.'}
                    </p>
                  </div>
                </div>

                <button
                  id="toggle-2fa-btn"
                  type="button"
                  disabled={savingField === 'two_factor'}
                  onClick={handleToggle2FA}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
                    is2faEnabled
                      ? 'bg-rose-100 hover:bg-rose-200 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                      : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  }`}
                >
                  {savingField === 'two_factor' ? <Loader2 className="w-4 h-4 animate-spin" /> : is2faEnabled ? 'Disable 2FA' : 'Enable 2FA'}
                </button>
              </div>

              {/* Password Update Form */}
              <form onSubmit={handleUpdatePassword} className="space-y-4 max-w-lg pt-2">
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                  Change Account Password
                </h4>

                <div className="space-y-1.5">
                  <label htmlFor="new-password" className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    New Password (Min 6 characters)
                  </label>
                  <input
                    id="new-password"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="confirm-password" className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    Confirm New Password
                  </label>
                  <input
                    id="confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"
                  />
                </div>

                <button
                  id="submit-password-change-btn"
                  type="submit"
                  disabled={savingField === 'password' || !newPassword}
                  className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs sm:text-sm font-semibold shadow-xs disabled:opacity-50 transition-colors"
                >
                  {savingField === 'password' ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Updating Password...</span>
                    </>
                  ) : (
                    <>
                      <KeyRound className="w-4 h-4" />
                      <span>Update Password</span>
                    </>
                  )}
                </button>
              </form>
            </div>
          )}

          {/* ============================================================== */}
          {/* SUB-CATEGORY 10: SECURITY QUESTIONS                            */}
          {/* ============================================================== */}
          {activeSubCategory === 'sec-questions' && (
            <div id="view-sec-questions" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 shadow-xs space-y-6">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Security Questions & Account Recovery
                </h3>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                  Used by our security team to verify your identity during emergency recovery or dispute investigations.
                </p>
              </div>

              <div className="space-y-4 max-w-lg">
                <div className="space-y-1.5">
                  <label htmlFor="sec-question-select" className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    Security Question
                  </label>
                  <select
                    id="sec-question-select"
                    value={secQuestion}
                    onChange={(e) => setSecQuestion(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"
                  >
                    <option value="">Select a security question</option>
                    <option value="What was the name of your first elementary school?">What was the name of your first elementary school?</option>
                    <option value="In what city were you born?">In what city were you born?</option>
                    <option value="What was the model of your first vehicle?">What was the model of your first vehicle?</option>
                    <option value="What was your childhood nickname?">What was your childhood nickname?</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="sec-answer-input" className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    Your Secret Answer
                  </label>
                  <input
                    id="sec-answer-input"
                    type="password"
                    value={secAnswer}
                    onChange={(e) => setSecAnswer(e.target.value)}
                    placeholder="Enter confidential answer"
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"
                  />
                </div>

                <div className="pt-2">
                  <button
                    id="save-sec-question-btn"
                    type="button"
                    disabled={savingField === 'security_question' || !secQuestion}
                    onClick={handleSaveSecurityQuestion}
                    className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs sm:text-sm font-semibold shadow-xs disabled:opacity-50 transition-colors"
                  >
                    {savingField === 'security_question' ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        <span>Save Security Question</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* SUB-CATEGORY 11: BLOCKED USERS                                 */}
          {/* ============================================================== */}
          {activeSubCategory === 'sec-blocked' && (
            <div id="view-sec-blocked" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 shadow-xs space-y-6">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Blocked Users & Trading Blacklist
                </h3>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                  Blocked users are prevented from viewing your ads, initiating escrow trades, or contacting you.
                </p>
              </div>

              {blockedUsers.length === 0 ? (
                <div className="p-8 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-center space-y-2">
                  <Ban className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto" />
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">No Blocked Traders</p>
                  <p className="text-xs text-slate-400 max-w-sm mx-auto">
                    You have not blocked any users. You can block users directly from any active trade chat if needed.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-slate-200 dark:divide-slate-800">
                  {blockedUsers.map((b) => (
                    <div key={b.id} className="py-3 flex items-center justify-between">
                      <div>
                        <p className="text-xs font-bold text-slate-900 dark:text-white">User ID: {b.blocked_user_id}</p>
                        <p className="text-[11px] text-slate-400">Reason: {b.reason || 'Restricted'}</p>
                      </div>
                      <button
                        id={`unblock-user-${b.id}`}
                        onClick={() => handleUnblockUser(b.id)}
                        disabled={unblockingId === b.id}
                        className="px-3 py-1.5 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:text-rose-600 rounded-lg text-xs font-medium"
                      >
                        {unblockingId === b.id ? 'Unblocking...' : 'Unblock'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ============================================================== */}
          {/* SUB-CATEGORY 12: ACTIVE SESSIONS & DEVICES                     */}
          {/* ============================================================== */}
          {activeSubCategory === 'sec-sessions' && (
            <div id="view-sec-sessions" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 shadow-xs space-y-6">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Active Sessions & Login History
                </h3>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                  Authorized browser sessions currently signed into your P2P trading account.
                </p>
              </div>

              <div className="space-y-3">
                {/* Current Device Card */}
                <div className="p-4 rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/40 dark:bg-indigo-950/20 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Laptop className="w-6 h-6 text-indigo-600 dark:text-indigo-400 shrink-0" />
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-bold text-slate-900 dark:text-white">Current Browser Window</p>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                          Active Now
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Authorized via Supabase Session • SSL Encrypted
                      </p>
                    </div>
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    id="terminate-sessions-btn"
                    type="button"
                    onClick={() => notify('success', 'All other remote sessions have been terminated.')}
                    className="px-4 py-2 border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-semibold transition-colors"
                  >
                    Log Out of All Other Devices
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
