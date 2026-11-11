export class Problem extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function supabaseAdapter(env, request = fetch) {
  const origin = env.SUPABASE_URL;
  const key = env.SUPABASE_PUBLISHABLE_KEY;
  const secret = env.SUPABASE_SECRET_KEY;
  async function call(path, { payload, token, admin = false } = {}) {
    if (!origin || !key || (admin && !secret)) throw new Problem(503, 'The service is being configured.');
    const apiKey = admin ? secret : key;
    const response = await request(new URL(path, origin), {
      method: payload === undefined ? 'GET' : 'POST',
      headers: {
        apikey: apiKey,
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(payload === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: AbortSignal.timeout(8000)
    });
    const data = response.status === 204 ? null : await response.json().catch(() => null);
    if (response.ok) return data;
    if (response.status === 401 || data?.code === 'PGRST301' || data?.code === 'PGRST303') {
      throw new Problem(401, 'Sign in to continue.');
    }
    if (response.status === 429) throw new Problem(429, 'Too many attempts. Try again later.');
    if (path.startsWith('/auth/')) throw new Problem(response.status >= 500 ? 503 : 400,
      response.status >= 500 ? 'Sign-in service is unavailable.' : 'Check your details or email confirmation link and try again.');
    if (data?.code === '23505') throw new Problem(409, 'This already exists.');
    if (data?.code === 'P0001' || data?.code === '42501') throw new Problem(response.status === 403 ? 403 : 400, data.message);
    if (/^22|^23/.test(data?.code ?? '')) throw new Problem(400, 'Check the form and try again.');
    throw new Problem(502, 'The data service is temporarily unavailable.');
  }
  return {
    configured: !!(origin && key),
    login: (email, password) => call('/auth/v1/token?grant_type=password', { payload: { email, password } }),
    signup: (email, password, challenge, redirect) => call('/auth/v1/signup?redirect_to=' + encodeURIComponent(redirect),
      { payload: { email, password, code_challenge: challenge, code_challenge_method: 's256' } }),
    recover: (email, challenge, redirect) => call('/auth/v1/recover?redirect_to=' + encodeURIComponent(redirect),
      { payload: { email, code_challenge: challenge, code_challenge_method: 's256' } }),
    exchange: (auth_code, code_verifier) => call('/auth/v1/token?grant_type=pkce', { payload: { auth_code, code_verifier } }),
    updatePassword: async (token, password) => {
      if (!origin || !key) throw new Problem(503, 'The service is being configured.');
      const response = await request(new URL('/auth/v1/user', origin), {
        method: 'PUT', headers: { apikey: key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }), signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) throw new Problem(400, 'Password could not be updated. Request a new link and try again.');
    },
    refresh: (refresh_token) => call('/auth/v1/token?grant_type=refresh_token', { payload: { refresh_token } }),
    logout: (token) => call('/auth/v1/logout?scope=local', { token, payload: {} }),
    rpc: (token, op, d) => call('/rest/v1/rpc/neighborhood_app', { token, payload: { op, d } }),
    syncBilling: (d) => call('/rest/v1/rpc/neighborhood_billing', { admin: true, payload: { d } })
  };
}
