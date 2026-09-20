import { useEffect, useState, useCallback } from 'react';
import SearchBar from './components/SearchBar';
import Filters from './components/Filters';
import YearsSummary from './components/YearsSummary';
import ResultCard from './components/ResultCard';
import { fetchMeta, fetchSearch } from './api';

const initialFilters = {
  subject: '', minYear: '', maxYear: '', difficulty: '', top: '25', showAnswers: false,
};

export default function App() {
  const [meta, setMeta] = useState(null);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState(initialFilters);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [lastQuery, setLastQuery] = useState('');

  useEffect(() => {
    fetchMeta()
      .then(m => {
        setMeta(m);
        setFilters(f => ({ ...f, minYear: m.min_year, maxYear: m.max_year }));
      })
      .catch(e => setError(e.message));
  }, []);

  const runSearch = useCallback(async (q, f) => {
    setError(null);
    setLastQuery(q);
    try {
      const r = await fetchSearch({
        q,
        subject: f.subject,
        min_year: f.minYear,
        max_year: f.maxYear,
        difficulty: f.difficulty,
        top: f.top,
      });
      setResult(r);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  const handleFilterChange = (patch) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    if (meta) runSearch(query, next);
  };

  const handleExampleClick = (text) => {
    setQuery(text);
    runSearch(text, filters);
  };

  if (!meta && !error) return <div className="wrap"><p className="empty">Loading…</p></div>;
  if (error && !meta) return <div className="wrap"><p className="empty">Something went wrong: {error}. Is the backend running?</p></div>;

  return (
    <div className="wrap">
      <h1>UPSC Prelims PYQ Search</h1>
      <p className="sub">
        {meta.count.toLocaleString()} UPSC Prelims questions, {meta.min_year}–{meta.max_year}.
        Search by concept, not just exact words.
      </p>

      <SearchBar
        query={query}
        onQueryChange={setQuery}
        onSubmit={() => runSearch(query, filters)}
        onExampleClick={handleExampleClick}
      />

      <Filters meta={meta} filters={filters} onChange={handleFilterChange} />

      <div id="out">
        {error && <p className="empty">Something went wrong: {error}. Is the backend running?</p>}
        {!error && !result && <p className="empty">Type a topic to search, or pick filters and search with an empty box to browse.</p>}
        {!error && result && result.results.length === 0 && <p className="empty">No questions match these filters.</p>}
        {!error && result && result.results.length > 0 && (
          <>
            <YearsSummary
              query={lastQuery}
              results={result.results}
              totalFiltered={result.total_filtered}
              yearsInResults={result.years_in_results}
            />
            {result.results.map(q => (
              <ResultCard key={`${q.year}-${q.q_no}`} q={q} query={lastQuery} showAllAnswers={filters.showAnswers} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
