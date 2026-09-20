import { useState } from 'react';
import { highlightSegments } from '../highlight.jsx';

export default function ResultCard({ q, query, showAllAnswers }) {
  const [revealed, setRevealed] = useState(false);
  const reveal = showAllAnswers || revealed;

  const status = q.status === 'cancelled'
    ? <span className="pill cancelled">Cancelled by UPSC</span>
    : q.status === 'disputed'
      ? <span className="pill disputed">Answer disputed</span>
      : null;

  return (
    <div className={`card${reveal ? ' reveal' : ''}`}>
      <div className="meta">
        <b>UPSC {q.year} · Q{q.q_no}</b>
        <span>{q.subject} › {q.subtopic}</span>
        <span className={`pill ${q.difficulty}`}>{q.difficulty}</span>
        {status}
        {query && <span className="match">match {Math.round(q.score * 100)}%</span>}
      </div>
      <p className="q">{highlightSegments(q.question, query)}</p>
      <ul className="opts">
        {['a', 'b', 'c', 'd'].map(k => (
          <li key={k} className={q.answer === k ? 'right' : ''}>
            ({k}) {highlightSegments(q[k], query)}
          </li>
        ))}
      </ul>
      {q.answer_note && <div className="note">Note: {q.answer_note}</div>}
      <button className="toggle" type="button" onClick={() => setRevealed(r => !r)}>
        Show / hide answer
      </button>
    </div>
  );
}
