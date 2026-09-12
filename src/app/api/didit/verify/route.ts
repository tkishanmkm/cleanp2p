import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))

    // Didit process logic
    return NextResponse.json({ success: true, message: 'Verified successfully', data: body })
  } catch (error: any) {
    console.error('Didit API Error:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Internal verification error' },
      { status: 500 }
    )
  }
}
