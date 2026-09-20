export default function Filters({ meta, filters, onChange }) {
  return (
    <div className="filters">
      <label>Subject
        <select value={filters.subject} onChange={e => onChange({ subject: e.target.value })}>
          <option value="">All</option>
          {meta.subjects.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <label>Years
        <input type="number" value={filters.minYear} min={meta.min_year} max={meta.max_year}
          onChange={e => onChange({ minYear: e.target.value })} /> –
        <input type="number" value={filters.maxYear} min={meta.min_year} max={meta.max_year}
          onChange={e => onChange({ maxYear: e.target.value })} />
      </label>
      <label>Difficulty
        <select value={filters.difficulty} onChange={e => onChange({ difficulty: e.target.value })}>
          <option value="">All</option>
          <option>easy</option>
          <option>moderate</option>
          <option>difficult</option>
        </select>
      </label>
      <label>Show
        <select value={filters.top} onChange={e => onChange({ top: e.target.value })}>
          <option>10</option>
          <option>25</option>
          <option>50</option>
          <option>100</option>
        </select>
      </label>
      <label>
        <input type="checkbox" checked={filters.showAnswers}
          onChange={e => onChange({ showAnswers: e.target.checked })} />
        Show all answers
      </label>
    </div>
  );
}
