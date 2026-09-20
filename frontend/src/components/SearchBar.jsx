const EXAMPLES = [
  'Harappan civilisation', 'Fundamental Rights', 'El Nino and monsoon',
  'Buddhist councils', 'inflation targeting RBI', 'tiger reserves',
];

export default function SearchBar({ query, onQueryChange, onSubmit, onExampleClick }) {
  return (
    <>
      <form className="searchbar" onSubmit={e => { e.preventDefault(); onSubmit(); }}>
        <input
          type="search"
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          placeholder="e.g. Harappan civilisation, Ramsar wetlands, money bill…"
          autoFocus
        />
        <button className="primary" type="submit">Search</button>
      </form>
      <div className="examples">Try:
        {EXAMPLES.map(ex => (
          <a key={ex} onClick={() => onExampleClick(ex)}>{ex}</a>
        ))}
      </div>
    </>
  );
}
