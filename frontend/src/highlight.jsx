export function highlightSegments(text, query) {
  const words = [...new Set((query.toLowerCase().match(/[a-z0-9]{3,}/g) || []))];
  if (words.length === 0) return text;
  const pattern = new RegExp(`\\b(${words.join('|')}\\w*)`, 'gi');
  return text.split(pattern).map((part, i) =>
    i % 2 === 1 ? <mark key={i}>{part}</mark> : part
  );
}
