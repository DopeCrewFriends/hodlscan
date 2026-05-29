import { createHash, randomBytes } from 'node:crypto';

const apiKey = `hs_pro_${randomBytes(24).toString('base64url')}`;
const keyHash = createHash('sha256').update(apiKey).digest('hex');

console.log('New Pro API key (show once):');
console.log(apiKey);
console.log('');
console.log('Insert into Supabase api_access_keys:');
console.log(
  JSON.stringify(
    {
      key_hash: keyHash,
      tier: 'pro',
      label: 'generated-key',
    },
    null,
    2,
  ),
);
console.log('');
console.log('Or add to HODLSCAN_PRO_API_KEYS in .env for quick testing.');
