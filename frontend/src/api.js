async function getJSON(path) {
  const res = await fetch(path);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

export function fetchMeta() {
  return getJSON('/api/meta');
}

export function fetchSearch(params) {
  const query = new URLSearchParams(params);
  return getJSON(`/api/search?${query}`);
}
