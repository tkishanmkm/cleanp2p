export async function saveAddressAndVerifyDidit(payload: any) {
  try {
    const res = await fetch('/api/didit/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const contentType = res.headers.get('content-type')

    // Safely parse non-JSON server responses
    if (!res.ok || !contentType?.includes('application/json')) {
      const htmlText = await res.text()
      console.error('API Error Response:', htmlText)
      throw new Error(`Server error (${res.status}). Check server logs.`)
    }

    const data = await res.json()
    return data
  } catch (err: any) {
    console.error('Verification failed:', err.message)
    throw err
  }
}
