/**
 * Resolves the n8n webhook URL for workflow calls.
 *
 * Switch to test webhook (localhost only):
 *   N8N_USE_TEST_WEBHOOK=true
 *   N8N_WEBHOOK_TEST_URL=https://prestonschlagheck.app.n8n.cloud/webhook-test/diffuse-workflow
 *
 * Production: set N8N_WEBHOOK_URL only.
 */
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL
const N8N_WEBHOOK_TEST_URL = process.env.N8N_WEBHOOK_TEST_URL
const N8N_USE_TEST_WEBHOOK = process.env.N8N_USE_TEST_WEBHOOK === 'true' || process.env.N8N_USE_TEST_WEBHOOK === '1'

export function getN8nWebhookUrl(): string | null {
  if (N8N_USE_TEST_WEBHOOK && N8N_WEBHOOK_TEST_URL) {
    return N8N_WEBHOOK_TEST_URL
  }
  return N8N_WEBHOOK_URL || null
}

export function requireN8nWebhookUrl(): string {
  const url = getN8nWebhookUrl()
  if (!url) {
    const hint = N8N_USE_TEST_WEBHOOK
      ? 'N8N_USE_TEST_WEBHOOK is enabled but N8N_WEBHOOK_TEST_URL is not set'
      : 'N8N_WEBHOOK_URL is required'
    throw new Error(`${hint}. Add the appropriate env var to .env.local`)
  }
  return url
}
