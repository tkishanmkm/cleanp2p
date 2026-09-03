'use client';

import React, { useEffect, useState } from 'react';
import OperationalDashboard from '@/components/admin/OperationalDashboard';
import { supabase } from '@/lib/supabase/client';

export default function OperationsPage() {
  const [authToken, setAuthToken] = useState<string>('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.access_token) {
        setAuthToken(data.session.access_token);
      }
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) {
        setAuthToken(session.access_token);
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  return (
    <div id="admin-operations-page-root">
      <OperationalDashboard authToken={authToken} />
    </div>
  );
}
