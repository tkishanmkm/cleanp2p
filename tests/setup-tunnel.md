# Local Webhook & Tunneling Setup Guide

This guide explains how to expose your local development server (`http://localhost:3000`) to the public internet for testing blockchain RPC webhooks, external cron triggers, and P2P notifications.

---

## 1. Quick Tunnel Options

### Option A: Cloudflare Tunnel (Recommended - No Sign-up Required)
Cloudflare provides free, high-speed, and secure public tunnels without requiring an account.

1. **Install cloudflared**:
   - macOS: `brew install cloudflare/cloudflare/cloudflared`
   - Linux: `curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb && sudo dpkg -i cloudflared.deb`
   - Windows: `winget install --id Cloudflare.cloudflared`

2. **Start the tunnel**:
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```

3. Copy the generated public URL (e.g., `https://random-words.trycloudflare.com`).

---

### Option B: LocalTunnel (Node.js Built-in)
No separate binary required; runs directly via `npx`:

```bash
npx localtunnel --port 3000
```

- When accessing the endpoint in a browser, enter the tunnel password (your public IP, retrieved via `curl https://localtunnel.me/api/ip`).
- For automated API or webhook calls, add the custom header to bypass the friendly splash screen:
  `bypass-tunnel-reminder: true`

---

### Option C: Ngrok
If you already have an ngrok account:

```bash
ngrok http 3000
```

---

## 2. Configuring Blockchain Webhooks

Once you have your public tunnel URL (e.g. `https://my-tunnel.trycloudflare.com`):

### Alchemy or QuickNode Webhooks
1. In Alchemy Dashboard, navigate to **Notify** -> **Create Webhook**.
2. Select **Address Activity** or **Custom Webhook**.
3. Target URL:
   ```
   https://my-tunnel.trycloudflare.com/api/webhooks/blockchain
   ```
4. Set the webhook signing secret in your `.env.local`:
   ```env
   ALCHEMY_WEBHOOK_SIGNING_KEY=your_signing_key_here
   ```

---

## 3. Testing External Cron Schedulers

You can trigger the multi-chain hot wallet sync from free cloud cron providers (e.g., [Cron-Job.org](https://cron-job.org) or GitHub Actions):

- **Method**: `POST` or `GET`
- **URL**: `https://my-tunnel.trycloudflare.com/api/jobs/blockchain-sync`
- **Headers**:
  ```http
  Authorization: Bearer YOUR_CRON_SECRET
  Content-Type: application/json
  ```

---

## 4. cURL Commands for Local Testing

### A. Trigger Blockchain Deposit & Withdrawal Sync
```bash
curl -X POST http://localhost:3000/api/jobs/blockchain-sync \
  -H "Authorization: Bearer test-cron-secret" \
  -H "Content-Type: application/json"
```

### B. Trigger Administrative Financial Reconciliation
```bash
curl -X POST http://localhost:3000/api/admin/reconcile \
  -H "Authorization: Bearer test-cron-secret" \
  -H "Content-Type: application/json"
```

### C. Fetch Administrative Metrics
```bash
curl -X GET http://localhost:3000/api/admin/metrics \
  -H "Cookie: sb-access-token=YOUR_ADMIN_JWT"
```

### D. Query Paginated Audit Logs
```bash
curl -X GET "http://localhost:3000/api/admin/audit-logs?page=1&limit=10" \
  -H "Cookie: sb-access-token=YOUR_ADMIN_JWT"
```
