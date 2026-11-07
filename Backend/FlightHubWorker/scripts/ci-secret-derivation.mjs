// Domain-separated keys derived from the Cloudflare deployment credential.
// No extra manually created GitHub secrets are required. Run ONLY in GitHub Actions.
import { createHmac } from 'node:crypto';
export function deriveServiceCredentials(accountId, apiToken) {
  if (!/^[a-f0-9]{32}$/i.test(accountId ?? '')) throw new Error('INVALID_CLOUDFLARE_ACCOUNT_ID');
  if (typeof apiToken !== 'string' || apiToken.length < 20) throw new Error('INVALID_CLOUDFLARE_API_TOKEN');
  const derive = (role) => createHmac('sha256', apiToken)
    .update(`iumrah-flight-hub:v1:${accountId.toLowerCase()}:${role}`)
    .digest('hex');
  return { bot: derive('bot-ingest'), admin: derive('admin') };
}
