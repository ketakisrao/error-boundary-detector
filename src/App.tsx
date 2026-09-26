import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Check, ChevronDown, ChevronRight, Clock3, Code2, Layers2, Moon, Search, ShoppingCart, Sun, X } from 'lucide-react';
import { componentName, teams, type Decision, type Team } from '../shared/triage';
import { currentAssignment, forHost, hostPages, parseHistory, recordReview, reviewStatus, reviewStorageKey, seedErrors, type ReviewHistory } from './dashboard';

type Theme = 'light' | 'dark';
type Filter = 'all' | 'pending' | 'reviewed';
function initialTheme(): Theme {
  try { const saved = localStorage.getItem('faultline-theme'); if (saved === 'light' || saved === 'dark') return saved; } catch { /* Optional storage. */ }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function loadHistory(): ReviewHistory {
  try { return parseHistory(sessionStorage.getItem(reviewStorageKey)); } catch { return {}; }
}
function relativeTime(timestamp: string) {
  const minutes = Math.max(1, Math.floor((Date.now() - Date.parse(timestamp)) / 60_000));
  return minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ago`;
}
function Assignment({ team }: { team: Decision['team'] }) {
  return team === 'Needs review' ? <span className="unassigned">Unassigned</span> : <span className="team-badge"><span>{team === 'Tax & Compliance' ? 'T' : team[0]}</span>{team}</span>;
}
function Status({ incident, history }: { incident: Decision; history: ReviewHistory }) {
  const status = reviewStatus(incident, history);
  return <span className={`status ${status === 'Needs review' ? 'pending' : status === 'Auto-assigned' ? 'automatic' : 'reviewed'}`}>
    {status === 'Needs review' ? <span className="status-dot" /> : status === 'Auto-assigned' ? <span className="status-dot" /> : <Check size={12} />}{status}
  </span>;
}

function ReviewDrawer({ incident, history, close, save }: {
  incident: Decision; history: ReviewHistory; close: () => void; save: (team: Team, note: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const assignment = currentAssignment(incident, history);
  const [team, setTeam] = useState<Team | ''>(assignment === 'Needs review' ? '' : assignment);
  const [note, setNote] = useState('');
  const [stackTab, setStackTab] = useState<'component' | 'call'>('component');
  const component = componentName(incident.envelope.componentStack[0]);
  useEffect(() => {
    const node = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    node.showModal();
    return () => { node.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  function submit(event: FormEvent) { event.preventDefault(); if (team) save(team, note); }
  return <dialog ref={dialog} className="review-dialog" aria-labelledby="review-title"
    onClose={event => { if (!event.currentTarget.open) close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <form onSubmit={submit} className="drawer">
      <header className="drawer-header"><div><span className="section-label">{incident.id}</span><h2 id="review-title">Review error</h2></div><button type="button" className="icon-button" onClick={close} aria-label="Close review" autoFocus><X size={19} /></button></header>
      <div className="drawer-body">
        <div className="error-detail"><span className="component-label"><Code2 size={16} />{component}</span><p>{incident.envelope.errorName}: {incident.envelope.errorMessage}</p><div><code>{incident.envelope.hostRoute}</code><span>·</span><time dateTime={incident.timestamp}>{new Date(incident.timestamp).toLocaleTimeString()}</time><span>·</span><span>Sample event</span></div></div>
        <div className="model-summary"><span>Jev assignment</span><Assignment team={incident.team} /><span className="confidence">{incident.answers ? `${Math.round(incident.answers.owner.confidence * 100)}% confidence` : 'Unavailable'}</span></div>
        <details className="decision-explanation"><summary>Decision details <ChevronDown size={13} /></summary><p>{incident.reason}</p></details>
        <div className="stack-panel"><div className="stack-tabs" role="group" aria-label="Stack type"><button type="button" aria-pressed={stackTab === 'component'} onClick={() => setStackTab('component')}>Component stack</button><button type="button" aria-pressed={stackTab === 'call'} onClick={() => setStackTab('call')}>Call stack</button></div><pre>{(stackTab === 'component' ? incident.envelope.componentStack : incident.envelope.callStack).join('\n') || 'No stack available.'}</pre></div>
        <section className="review-fields"><h3>Assignment</h3><label htmlFor="assigned-team">Assign to team</label><div className="select-wrap"><select id="assigned-team" value={team} onChange={event => setTeam(event.target.value as Team | '')} required><option value="" disabled>Select a team</option>{teams.map(value => <option key={value}>{value}</option>)}</select><ChevronDown size={14} /></div><label htmlFor="review-note">Review note <span>optional</span></label><textarea id="review-note" maxLength={500} rows={3} value={note} onChange={event => setNote(event.target.value)} placeholder="Why is this the right team?" /></section>
        {!!history[incident.id]?.length && <section className="review-history"><h3>Review history</h3>{[...history[incident.id]].reverse().map((review, index) => <div className="history-entry" key={`${review.timestamp}-${index}`}><div><span className="history-avatar">Y</span><strong>You</strong><span>{relativeTime(review.timestamp)}</span></div><p>{review.fromTeam === review.toTeam ? `Confirmed ${review.toTeam}` : <>{review.fromTeam === 'Needs review' ? 'Unassigned' : review.fromTeam}<ArrowRight size={12} />{review.toTeam}</>}</p>{review.note && <small>{review.note}</small>}</div>)}</section>}
      </div>
      <footer className="drawer-footer"><span>Saved in this browser session</span><button type="button" className="button secondary" onClick={close}>Cancel</button><button className="button primary" type="submit" disabled={!team}>{team === assignment ? 'Confirm assignment' : 'Reroute error'}</button></footer>
    </form>
  </dialog>;
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [incidents] = useState(seedErrors);
  const [host, setHost] = useState<Team>('Cart');
  const [history, setHistory] = useState<ReviewHistory>(loadHistory);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [storageWarning, setStorageWarning] = useState(false);
  const [, tick] = useState(0);
  const sourceErrors = forHost(incidents, host);
  const pending = sourceErrors.filter(item => reviewStatus(item, history) === 'Needs review').length;
  const reviewed = sourceErrors.filter(item => history[item.id]?.length).length;
  const filtered = sourceErrors.filter(item => {
    const reviewed = !!history[item.id]?.length;
    return (filter === 'all' || (filter === 'reviewed' ? reviewed : reviewStatus(item, history) === 'Needs review')) &&
      `${componentName(item.envelope.componentStack[0])} ${item.envelope.errorMessage} ${currentAssignment(item, history)} ${item.id}`.toLowerCase().includes(search.toLowerCase());
  });
  const activeIncident = incidents.find(item => item.id === selected);
  const page = hostPages.find(item => item.team === host)!;
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#14151a' : '#f7f8fa');
    try { localStorage.setItem('faultline-theme', theme); } catch { /* Optional storage. */ }
  }, [theme]);
  useEffect(() => { const timer = setInterval(() => tick(value => value + 1), 60_000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 3500); return () => clearTimeout(timer); }, [toast]);
  function saveReview(team: Team, note: string) {
    if (!activeIncident) return;
    const previous = currentAssignment(activeIncident, history);
    const next = recordReview(activeIncident, history, team, note);
    try { sessionStorage.setItem(reviewStorageKey, JSON.stringify(next)); setStorageWarning(false); }
    catch { setStorageWarning(true); }
    setHistory(next); setSelected(null);
    setToast(previous === team ? `Assignment to ${team} confirmed` : `Error rerouted to ${team}`);
  }
  return <div className="app">
    <header className="app-header"><a className="brand" href="#" onClick={event => { event.preventDefault(); setHost('Cart'); setFilter('all'); setSearch(''); }} aria-label="Faultline home"><span className="brand-icon"><Layers2 size={20} /></span>faultline</a><div className="header-divider" /><span className="header-product">Error tracking</span><div className="header-actions"><span className="demo-label"><span />Demo workspace</span><button className="icon-button theme-toggle" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`} title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>{theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}</button><span className="user-avatar" title="Local demo reviewer">Y</span></div></header>
    <main>
      <nav className="team-breadcrumb" aria-label="Team selection"><span>Teams</span><ChevronRight size={14} /><div className="host-select">{host === 'Cart' ? <ShoppingCart size={15} /> : <Layers2 size={15} />}<select aria-label="Host team" value={host} onChange={event => { setHost(event.target.value as Team); setFilter('all'); setSearch(''); }}>{hostPages.map(item => <option key={item.team} value={item.team}>{item.team}</option>)}</select><ChevronDown size={13} /></div><ChevronRight size={14} /><strong>Errors</strong></nav>
      <div className="page-heading"><div><h1>Errors <span>{sourceErrors.length}</span></h1><p>Frontend exceptions on <code>{page.route}</code></p></div><span className="scope-note"><Clock3 size={13} />Current demo session</span></div>
      <section className="error-list" aria-label={`${host} page errors`}>
        <div className="table-toolbar"><div className="filters" role="group" aria-label="Review status">{([['all', 'All errors', sourceErrors.length], ['pending', 'Needs review', pending], ['reviewed', 'Reviewed', reviewed]] as const).map(([value, label, count]) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}<span>{count}</span></button>)}</div><label className="search"><Search size={15} /><input aria-label="Search errors" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search component or error…" />{search && <button onClick={() => setSearch('')} aria-label="Clear search"><X size={13} /></button>}</label></div>
        <div className="table-scroll"><table><thead><tr><th scope="col">Component / Error</th><th scope="col">Page</th><th scope="col">Assigned team</th><th scope="col">Jev confidence</th><th scope="col">Status</th><th scope="col">Last seen</th><th scope="col"><span className="sr-only">Review</span></th></tr></thead><tbody>{filtered.map(item => <tr key={item.id} className={selected === item.id ? 'selected' : ''}><td><button className="error-link" onClick={() => setSelected(item.id)}><span className="error-glyph"><Code2 size={16} /></span><span><strong>{componentName(item.envelope.componentStack[0])}</strong><small>{item.envelope.errorMessage}</small></span></button></td><td><code className="route">{item.envelope.hostRoute}</code></td><td><Assignment team={currentAssignment(item, history)} /></td><td><span className={`confidence-cell ${item.answers && item.answers.owner.confidence < .75 ? 'uncertain' : ''}`}>{item.answers ? `${Math.round(item.answers.owner.confidence * 100)}%` : '—'}</span></td><td><Status incident={item} history={history} /></td><td><time className="last-seen" dateTime={item.timestamp} title={new Date(item.timestamp).toLocaleString()}>{relativeTime(item.timestamp)}</time></td><td><button className="review-button" onClick={() => setSelected(item.id)} aria-label={`Review ${componentName(item.envelope.componentStack[0])} ${item.id}`}>Review<ChevronRight size={13} /></button></td></tr>)}</tbody></table></div>
        {!filtered.length && <div className="empty-state"><Search size={22} /><h2>No matching errors</h2><button onClick={() => { setSearch(''); setFilter('all'); }}>Clear filters</button></div>}
        <footer className="table-footer"><span>{filtered.length} of {sourceErrors.length} errors</span><span>Sample events · Manual reviews saved in this session</span></footer>
      </section>
      {storageWarning && <p className="storage-warning" role="alert">Browser storage is unavailable. Your review is applied, but will be lost on refresh.</p>}
    </main>
    {activeIncident && <ReviewDrawer key={activeIncident.id} incident={activeIncident} history={history} close={() => setSelected(null)} save={saveReview} />}
    {toast && <div className="toast" role="status"><Check size={15} />{toast}<button onClick={() => setToast('')} aria-label="Dismiss notification"><X size={14} /></button></div>}
  </div>;
}
