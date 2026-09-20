const API_BASE = import.meta.env.VITE_API_BASE || '';

async function getJSON(path) {
  const res = await fetch(API_BASE + path);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data?.detail ?? data?.error;
    throw new Error(
      typeof detail === 'string' ? detail : `${res.status} ${res.statusText}`
    );
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export function fetchMeta() {
  return getJSON('/api/meta');
}

export function fetchSearch(params) {
  const query = new URLSearchParams(params);
  return getJSON(`/api/search?${query}`);
}
