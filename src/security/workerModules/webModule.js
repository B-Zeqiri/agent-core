const fetch = global.fetch || require('node-fetch');

module.exports = async function(payload) {
  // payload: { args, metadata }
  const { args, metadata } = payload || {};
  const url = args.url;
  const method = args.method || 'GET';
  const headers = args.headers || {};
  const body = args.body ? JSON.stringify(args.body) : undefined;

  // optional domain allowlist in metadata.allowedDomains
  if (metadata && metadata.allowedDomains && metadata.allowedDomains.length > 0) {
    const domain = new URL(url).hostname;
    const allowed = metadata.allowedDomains.some(d => domain === d || domain.endsWith('.' + d));
    if (!allowed) throw new Error('Domain not allowed');
  }

  const res = await fetch(url, { method, headers, body });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return await res.json();
  return await res.text();
};
