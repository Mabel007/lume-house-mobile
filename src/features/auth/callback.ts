export type Callback = { kind: 'code'; code: string; flowId?: string } | { kind: 'error' } | { kind: 'invalid' };

// Never return provider descriptions, fragments or credentials to the UI.
export function parseCallback(value: string, expected: string): Callback {
  try {
    const url = new URL(value);
    const target = new URL(expected);
    if (url.protocol !== target.protocol || url.host !== target.host || url.pathname !== target.pathname ||
        url.username || url.password || url.hash) return { kind: 'invalid' };
    if (url.searchParams.has('error') || url.searchParams.has('error_code')) return { kind: 'error' };
    const codes = url.searchParams.getAll('code');
    if (codes.length !== 1 || !/^[A-Za-z0-9_-]{1,512}$/.test(codes[0]) ||
        url.searchParams.has('access_token') || url.searchParams.has('refresh_token')) return { kind: 'invalid' };
    const flows = url.searchParams.getAll('sb_flow_id');
    if (flows.length > 1 || (flows.length === 1 && !/^[A-Za-z0-9_-]{8,64}$/.test(flows[0]))) return { kind: 'invalid' };
    return { kind: 'code', code: codes[0], flowId: flows[0] };
  } catch { return { kind: 'invalid' }; }
}

export function pendingIsFresh(value: string | null, now: number): boolean {
  if (!value) return false;
  const started = Number(value);
  return Number.isFinite(started) && started > 0 && now >= started && now - started < 10 * 60 * 1000;
}
