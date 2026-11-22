import { NextResponse } from 'next/server';

/**
 * Minimal liveness endpoint. Never disclose environment configuration,
 * secret-presence flags, internal hostnames, database errors, or key metadata.
 * Database readiness is monitored through the protected deployment/runtime
 * control plane, not an unauthenticated public health response.
 */
export async function GET() {
  return NextResponse.json(
    { status: 'ok', timestamp: new Date().toISOString() },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
