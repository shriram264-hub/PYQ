export default function YearsSummary({ query, results, totalFiltered, yearsInResults }) {
  return (
    <>
      <div className="summary">
        {query ? `Top ${results.length} matches for "${query}"` : `Showing ${results.length}`}
        {' '}from {totalFiltered.toLocaleString()} questions in range. Years in these results:
      </div>
      <div className="years">
        {Object.entries(yearsInResults).map(([y, n]) => <span key={y}>{y} × {n}</span>)}
      </div>
    </>
  );
}
