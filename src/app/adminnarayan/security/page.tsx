import { AdminSecurityClient } from './admin-security-client';

export const metadata = {
  title: 'Admin Security Foundation | Paxones Admin',
  description: 'Manage Admin Theme, Authenticator 2FA, Recovery Passwords, and Audit Logging.',
};

export default function AdminSecurityPage() {
  return <AdminSecurityClient />;
}
