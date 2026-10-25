// Where /plans sends a student back to after buying: the `return` query
// parameter an Upgrade prompt put there (scripts/upgrade.js upgradeHref). It is
// in the address, so anyone can write a link with any value in it; only a path
// on this site may come out, never another site or a script URL (an open
// redirect would let a phishing link borrow our address).

const MAX = 512;
// A scheme at the start, as the URL parser reads one: 'javascript:', 'https:'.
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
// Anything the URL parser strips or treats as a separator before it reads the
// host: control characters and spaces (tabs and newlines are removed, so
// '/\t/evil' would become '//evil'). A real path of ours has none of them raw.
const UNSAFE = /[\u0000- \u007f]/;
const BASE = 'https://x.invalid';

function looksLocal(s) {
  return s.length > 0 && s.length <= MAX && s[0] === '/' && s[1] !== '/' && s[1] !== '\\' && !SCHEME.test(s);
}

/**
 * The path, query and hash of `raw` when it is a path on this site, else null.
 * The decoded form must pass too, so an escaped '//' ('/%2F%2F') is refused.
 * (Only the raw text is checked for UNSAFE: a search for two words decodes to a
 * space, which is harmless, since the raw text is what is parsed.) The URL
 * parser has the last word: if it reads another origin, it is refused.
 */
export function safeReturn(raw) {
  if (typeof raw !== 'string' || !looksLocal(raw) || UNSAFE.test(raw)) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (!looksLocal(decoded)) return null;
  let url;
  try {
    url = new URL(raw, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;
  // The parser resolves dot segments, so '/.//evil.example' comes out as
  // '//evil.example': a protocol-relative address to another site once it is
  // used as an href or passed to location.assign. What is returned must pass
  // the same checks as what came in.
  const out = url.pathname + url.search + url.hash;
  return looksLocal(out) ? out : null;
}
