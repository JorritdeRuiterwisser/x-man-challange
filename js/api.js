import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const KEY = 'xman_token';

export function getToken() { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } }
export function setToken(t) { try { localStorage.setItem(KEY, t); } catch { /* privémodus */ } }
export function clearToken() { try { localStorage.removeItem(KEY); } catch { /* */ } }

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export async function rpc(fn, args = {}) {
  if (SUPABASE_KEY.startsWith('PLAK_HIER')) throw new ApiError('De Supabase-sleutel is nog niet ingevuld in js/config.js', 0);
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY },
      body: JSON.stringify(args),
    });
  } catch {
    throw new ApiError('Geen verbinding. Probeer het zo nog eens.', 0);
  }
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* geen json */ }
  if (!res.ok) {
    const msg = (body && body.message) || 'Er ging iets mis';
    throw new ApiError(msg, res.status);
  }
  return body;
}
