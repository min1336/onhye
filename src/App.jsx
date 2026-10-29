import { reportClientError } from './telemetry.mjs';
import { recommend } from '../shared/recommendation.mjs';
import BotCheck from './BotCheck.jsx';
import { localGuidance } from '../shared/local-replies.mjs';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, ArrowUpRight, BookOpen, Check, ChevronLeft, ChevronRight, CircleHelp, Database, Download, LoaderCircle, MessageCirclePlus, Search, SlidersHorizontal } from 'lucide-react';
import { BenefitCard, BrandMark, Dialog, EMPTY_PROFILE, PrivacyNote, ProfileForm, Steps, TOPICS } from './components.jsx';

async function api(url, body, headers = {}) {
  let response;
  try { response = await fetch(url, { ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(body?.mode === 'gemini' ? 30000 : 15000) }); }
  catch { reportClientError('network_error', url); throw new Error('서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.'); }
  let data;
  try { data = await response.json(); } catch { reportClientError('invalid_response', url, response.headers.get('x-request-id')); throw new Error('서버 응답을 확인하지 못했어요.'); }
  if (!response.ok) throw new Error(data.error || '요청을 처리하지 못했어요.');
  return data;
}

import Catalogue from './Catalogue.jsx';
import { EXTRA_SOURCES } from '../shared/sources.mjs';
import { extractProfile, redactMoney } from '../shared/profile.mjs';

const EXAMPLES = ['취업을 준비하고 있어요', '주거비가 부담돼요', '아이를 키우고 있어요'];

function ResultsPagination({ page, pages, busy, onPage }) {
  return <nav className="results-pagination" aria-label="관련 후보 페이지">
    <button disabled={busy || page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft size={16} />이전</button>
    <span className="pagination-position"><strong aria-current="page">{page.toLocaleString()}</strong><span>/</span>{(pages || 1).toLocaleString()}<span className="sr-only">페이지</span></span>
    <button disabled={busy || page >= pages} onClick={() => onPage(page + 1)}>다음<ChevronRight size={16} /></button>
  </nav>;
}

export default function App() {
  const [view, setView] = useState('chat');
  const [catalog, setCatalog] = useState(null);
  const [status, setStatus] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [dialog, setDialog] = useState(null);
  const [text, setText] = useState('');
  const [messages, setMessages] = useState([]);
  const [topics, setTopics] = useState([]);
  const [preferredTopics, setPreferredTopics] = useState([]);
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  const [stage, setStage] = useState('intro');
  const [mode, setMode] = useState('demo');
  const [botToken, setBotToken] = useState('');
  const [botNonce, setBotNonce] = useState(0);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState(null);
  const [saved, setSaved] = useState([]);
  const [includeClosed, setIncludeClosed] = useState(false);
  const [filter, setFilter] = useState('all');
  const [notice, setNotice] = useState('');
  const inputRef = useRef(null);
  const sectionRef = useRef(null);
  const requestId = useRef(0);

  async function load() {
    setLoadError('');
    try { const [data, config] = await Promise.all([api('/api/catalog-meta'), api('/api/status')]); setCatalog(data); setStatus(config); setMode(config.geminiAvailable ? 'gemini' : 'demo'); }
    catch (e) { setLoadError(e.message); }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => { if (notice) { const timer = setTimeout(() => setNotice(''), 3500); return () => clearTimeout(timer); } }, [notice]);
  function reset() {
    setView('chat');
    requestId.current++;
    setPreferredTopics([]); setIncludeClosed(false); setMessages([]); setText(''); setTopics([]); setProfile(EMPTY_PROFILE); setStage('intro'); setResults(null); setSaved([]); setFilter('all'); setError(''); setBusy(false); setConsent(false); setNotice('상담 내용을 지웠어요. 새로 시작해 보세요.');
    window.scrollTo({ top: 0, behavior: 'smooth' }); inputRef.current?.focus();
  }
  async function submit(event) {
    event.preventDefault();
    if (busy || !text.trim()) return;
    if (text.trim().length < 2) { setError('상황을 두 글자 이상 적어 주세요.'); return; }
    if (text.length > 2000) { setError('상황은 2,000자 이내로 적어 주세요.'); return; }
    if (/\d{6}[ -]?[1-4]\d{6}|\b01[016789][ -]?\d{3,4}[ -]?\d{4}\b/.test(text)) { setError('주민등록번호나 전화번호는 지우고 상황만 알려주세요.'); return; }
    const paid = mode === 'gemini' && !localGuidance(text);
    if (paid && !consent) { setError('상황 설명을 AI에 보내는 데 동의해 주세요. 직접 분야 선택도 가능해요.'); return; }
    if (paid && status?.botRequired && status?.botProvider !== 'vercel' && !botToken) { setError('봇 방지 확인을 완료하거나 직접 분야를 선택해 주세요.'); return; }
    const current = ++requestId.current;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api('/api/analyze', { text: redactMoney(text.trim()), mode, consent, ...(paid && botToken ? { turnstileToken: botToken } : {}) }, paid ? { 'X-CSRF-Token': status?.csrfToken || '', 'X-Request-ID': crypto.randomUUID() } : {});
      if (current !== requestId.current) return;
      if (result.guidance) { setMessages([{ role: 'user', text: text.trim() }, { role: 'assistant', text: result.guidance }]); setText(''); return; }
      setMessages([{ role: 'user', text: text.trim() }, { role: 'assistant', text: result.topics.length ? '상황에서 찾은 관심 분야를 미리 선택했어요. 분야와 조건을 확인하면 먼저 살펴볼 후보를 최대 5개 정리해 드려요.' : '입력한 상황을 확인해 주세요. 분야를 선택하지 않으면 모든 분야에서 후보를 찾아요.' }, ...(result.topics.some(key => result.answers?.[key]?.evidence) ? [{ role: 'assistant', text: '분야를 제안한 입력 근거: ' + result.topics.filter(key => result.answers?.[key]?.evidence).map(key => `${TOPICS[key]} — “${result.answers[key].evidence.slice(0, 100)}”`).join(' · ') }] : []), ...(result.uncertain.length ? [{ role: 'assistant', text: `확인이 필요한 분야: ${result.uncertain.map(key => TOPICS[key]).join(' · ')}. 필요한 도움이라면 아래에서 선택해 주세요.` }] : [])]);
      setProfile(extractProfile(text)); setPreferredTopics(result.topics); setTopics(result.topics); setText(''); setStage('confirm'); setResults(null); setFilter('all');
      setTimeout(() => sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    } catch (e) { if (current === requestId.current) setError(e.message); }
    finally { if (paid) { setBotToken(''); setBotNonce(value => value + 1); } if (current === requestId.current) setBusy(false); }
  }
  async function findBenefits(page = 1, closed = includeClosed, nextFilter = 'all') {
    const current = ++requestId.current;
    setBusy(true); setError('');
    try {
      const result = await api('/api/recommend', { topics, profile, preferredTopics, page, includeClosed: closed, resultTopic: nextFilter === 'all' ? null : nextFilter });
      if (current !== requestId.current) return;
      setResults(result); setStage('results'); setFilter(nextFilter);
      setTimeout(() => document.getElementById('benefit-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    } catch (e) { if (current === requestId.current) setError(e.message); }
    finally { if (current === requestId.current) setBusy(false); }
  }
  function saveSummary() {
    const selection = evaluatedSaved.length ? evaluatedSaved : results.shortlist?.items || [];
    const content = ['온혜 혜택 탐색 메모', `공식 안내 확인일: ${catalog.checkedAt}`, `${catalog.mode === 'api-snapshot' ? '복지 API 수집본' : '공식 안내 수동 요약본'}이며, 지원 자격·지급은 확정되지 않았습니다.`, '', ...selection.flatMap(b => [b.title, b.summary, '확인할 조건: ' + b.checks.join(', '), b.application, b.url, ''])].join('\n');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = '온혜_혜택_탐색메모.txt'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(`${selection.length}개 제도의 안내를 저장했어요. 상황 설명과 개인정보는 포함하지 않았어요.`);
  }
  const evaluatedSaved = useMemo(() => recommend(saved, [], profile, preferredTopics, true), [saved, profile, preferredTopics]);
  function refine(field) {
    setStage('confirm'); setResults(null); setFilter('all');
    setTimeout(() => { const target = document.getElementById('profile-' + field); const details = target?.closest('details'); if (details) details.open = true; target?.focus(); }, 80);
  }
  const visible = filter === 'saved' ? evaluatedSaved : results?.items || [];
  const displayResults = filter === 'saved' ? { items: evaluatedSaved, total: evaluatedSaved.length, groups: Object.fromEntries(['matched', 'unknown', 'outside'].map(group => [group, evaluatedSaved.filter(item => item.group === group).length])) } : results;

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">본문으로 바로가기</a>
    <aside className="sidebar">
      <a className="brand" href="#" onClick={e => { e.preventDefault(); reset(); }} aria-label="온혜 처음으로"><BrandMark /><span><strong>온혜</strong><small>일상의 든든한 혜택 동행</small></span></a>
      <button className="new-chat" onClick={reset}><MessageCirclePlus size={19} />새 상담 시작</button>
      <nav aria-label="주요 메뉴"><button className={`nav-item ${view === 'chat' ? 'active' : ''}`} onClick={() => { setDialog(null); setView('chat'); inputRef.current?.focus(); }}><Search size={20} />혜택 찾아보기</button><button className={`nav-item ${view === 'catalogue' ? 'active' : ''}`} onClick={() => setView('catalogue')}><Database size={20} />전체 제도·공고</button><button className="nav-item" onClick={() => setDialog('help')}><CircleHelp size={20} />이용 안내</button></nav>
      <div className="sidebar-bottom"><button className="source-button" onClick={() => setDialog('sources')}><Database size={18} />데이터 출처<ArrowUpRight size={15} /></button><p>공식 기관 안내 기반</p><span>내 상황에 맞는 제도를 찾고,<br />정확한 조건은 공식 안내에서.</span><div className="sidebar-foot">공식 채널 수집본 기준</div></div>
    </aside>
    <div className="workspace"><header className="topbar"><span>{view === 'catalogue' ? '전체 제도·공고' : '혜택 찾아보기'}</span><button className="catalogue-shortcut" onClick={() => setView(view === 'catalogue' ? 'chat' : 'catalogue')}>{view === 'catalogue' ? '상담으로 돌아가기' : `전체 ${catalog?.count.toLocaleString() || 0}개 제도·공고`}</button></header>
      <main id="main-content" className={`main-content ${view === 'chat' && stage === 'results' ? 'has-results' : ''}`}>
        {view === 'catalogue' ? <Catalogue catalog={catalog} /> : <>
        <section className={`intro ${stage !== 'intro' ? 'compact' : ''}`}><div className="intro-copy"><h1>몰랐던 혜택,<br /><em>내 이야기에서 찾아요.</em></h1><p>나이, 거주지역, 요즘의 고민을 편하게 알려주세요.</p>{catalog && <p>제도 {catalog.coverage.imported.toLocaleString()}개 · 수집 시 모집 중 공고 {catalog.announcementCoverage.accepting.toLocaleString()}개<br />추가 {catalog.channelCoverage?.length || 0}개 채널 {catalog.additionalCount?.toLocaleString() || 0}건 수집 · 채널별 범위는 출처에서 확인</p>}</div><div className="intro-symbol" aria-hidden="true"><BrandMark /></div></section>
        {stage === 'intro' && <div className="example-prompts" aria-label="상황 예시">{EXAMPLES.map(example => <button key={example} onClick={() => { setText(example); inputRef.current?.focus(); }}>{example}<ChevronRight size={17} /></button>)}</div>}
        {loadError && <div className="load-error" role="alert"><p>{loadError}</p><button onClick={load}>목록 다시 불러오기</button></div>}
        <section className="chat-panel" aria-label="혜택 탐색 대화" ref={sectionRef}>
          <div className="conversation" aria-live="polite" aria-busy={busy}>
            <div className="assistant-message"><div className="assistant-avatar"><BrandMark small /></div><div><p className="greeting">안녕하세요! 지금 어떤 도움이 필요하세요?</p><p className="assistant-description">이름이나 주민등록번호 같은 개인정보는 필요하지 않아요.<br className="desktop-break" /> 편하게 말씀해 주시면, 관련된 제도를 함께 찾아볼게요.</p></div></div>
            {messages.map((message, i) => <div className={`message ${message.role}`} key={i}>{message.role === 'assistant' && <div className="assistant-avatar"><BrandMark small /></div>}<p>{message.text}</p></div>)}
            {busy && <div className="loading-message"><LoaderCircle className="spin" size={16} />{stage === 'confirm' ? '공식 안내를 정리하고 있어요…' : '관심 분야를 살펴보고 있어요…'}</div>}
          </div>
          {stage === 'confirm' && <><p className="form-note">대화에서 찾은 우선 분야: {preferredTopics.length ? preferredTopics.map(key => TOPICS[key]).join(' · ') : '없음 · 전체 분야 탐색'}. 관심 분야를 수정하거나 모두 해제해 전체를 탐색할 수 있어요.</p><ProfileForm topics={topics} setTopics={setTopics} profile={profile} setProfile={setProfile} onSubmit={findBenefits} busy={busy} /></>}
          {stage === 'results' && <div className="confirmed-summary"><Check size={17} /><span>{(topics.length ? topics.map(t => TOPICS[t]).join(' · ') : '전체 분야')}{profile.region !== 'unknown' ? ` / ${profile.region}` : ''}{profile.district ? ` ${profile.district}` : ''}{profile.age !== null ? ` / 만 ${profile.age}세` : ''}</span><button onClick={() => { setStage('confirm'); setResults(null); setFilter('all'); }}>조건 수정<SlidersHorizontal size={14} /></button></div>}
          <form className="composer" onSubmit={submit}><label className="sr-only" htmlFor="situation">나의 상황</label><div className="composer-input"><textarea id="situation" ref={inputRef} rows={2} maxLength={2000} value={text} onChange={e => { setText(e.target.value); setError(''); }} placeholder={stage === 'intro' ? '예: 25살이고 경기도에서 취업을 준비하고 있어요.' : '다른 고민이 있다면 새로 이야기해 주세요.'} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(e); } }} /><button className="send-button" type="submit" aria-label="상황 보내기" disabled={busy || !text.trim() || !catalog}>{busy ? <LoaderCircle className="spin" size={21} /> : <ArrowUp size={23} />}</button></div>
            {mode === 'gemini' && <label className="consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />상황 설명을 Google Cloud Gemini에 보내는 데 동의합니다. 개인정보는 입력하지 마세요.</label>}
            {mode === 'gemini' && status?.botRequired && status.turnstileSiteKey && <BotCheck siteKey={status.turnstileSiteKey} nonce={botNonce} onToken={setBotToken} />}
            {error && <p role="alert" className="error-message">{error}</p>}<PrivacyNote />
          </form>
        </section>
        <div role="status" className={notice ? 'toast' : 'sr-only'}>{notice}</div>
        {results ? <section id="benefit-results" className="results-section" aria-labelledby="results-title">
          <div className="results-heading">
            <div className="results-title-row"><div><h2 id="results-title">{filter === 'saved' ? '담은 혜택' : '먼저 확인할 지원 후보'} <span>{(filter === 'saved' ? displayResults.total : results.shortlist?.items.length || 0).toLocaleString()}개</span></h2><p>입력조건 비교 결과입니다. 최종 지원 자격은 공식 안내에서 확인해 주세요.</p></div><button className="outline-button" onClick={saveSummary} disabled={!(filter === 'saved' ? evaluatedSaved.length : results.shortlist?.items.length) && !saved.length}><Download size={16} />{saved.length ? `${saved.length}개 담은 혜택 저장` : '탐색 메모 저장'}</button></div>
          </div>
          {filter !== 'saved' && <>
            <p className="shortlist-note">{results.shortlist?.focus.length ? `우선 분야: ${results.shortlist.focus.map(key => TOPICS[key]).join(' · ')}. ` : ''}{results.shortlist?.explanation}</p>
            {!!results.shortlist?.followUps.length && <div className="followup-panel"><div><strong>알려주시면 더 좁힐 수 있어요</strong><p>모르는 정보는 비워둘 수 있습니다. 상세 조건 입력은 AI에 보내지 않습니다.</p></div><div>{results.shortlist.followUps.map(question => <button key={question.field} onClick={() => refine(question.field)}>{question.label}<ChevronRight size={15} /></button>)}</div></div>}
            <div className="benefits-grid shortlist-grid">{results.shortlist?.items.map(benefit => <BenefitCard key={benefit.id} benefit={benefit} compact saved={saved.some(item => item.id === benefit.id)} onSave={() => setSaved(saved.some(item => item.id === benefit.id) ? saved.filter(item => item.id !== benefit.id) : [...saved, benefit])} />)}</div>
            {!results.shortlist?.items.length && <div className="empty-state"><Search size={24} /><h3>관심 분야나 조건을 조금 더 알려주세요</h3><p>정보가 부족한 상태에서 관련 없는 혜택을 우선 후보로 채우지 않습니다. 전체 탐색 목록은 아래에서 확인할 수 있어요.</p><button onClick={() => refine('topics')}>분야·조건 확인하기</button></div>}
          </>}
          <section className="extended-results" aria-label="전체 탐색 후보"><h3>{filter === 'saved' ? `담은 혜택 ${displayResults.total.toLocaleString()}개` : `전체 탐색 후보 ${displayResults.total.toLocaleString()}개 확인하기 · 우선 후보 포함`}</h3><p className="form-note">아래 수치는 전체 탐색 후보 기준입니다. 미검증 조건·예외 대상도 포함하며 수급 가능 건수가 아닙니다.</p>
            <dl className="results-stats"><div className="stat-matched"><dt><span />입력조건 일치</dt><dd>{(displayResults.groups?.matched || 0).toLocaleString()}<small>개</small></dd></div><div className="stat-unknown"><dt><span />필수정보·조건 확인 필요</dt><dd>{(displayResults.groups?.unknown || 0).toLocaleString()}<small>개</small></dd></div><div className="stat-outside"><dt><span />확인한 조건 불일치</dt><dd>{(displayResults.groups?.outside || 0).toLocaleString()}<small>개</small></dd></div></dl>
          <div className="results-controls"><label className="consent"><input type="checkbox" checked={includeClosed} disabled={busy} onChange={e => { setIncludeClosed(e.target.checked); findBenefits(1, e.target.checked, filter === 'saved' ? 'all' : filter); }} />모집 종료 공고도 포함하기</label></div>
          <div className="results-view-bar"><div className="results-filters result-tabs" aria-label="추천 결과 필터"><button aria-pressed={filter === 'all'} className={filter === 'all' ? 'selected' : ''} disabled={busy} onClick={() => findBenefits(1, includeClosed, 'all')}>전체</button>{topics.map(topic => <button key={topic} aria-pressed={filter === topic} className={filter === topic ? 'selected' : ''} disabled={busy} onClick={() => findBenefits(1, includeClosed, topic)}>{TOPICS[topic]}</button>)}<button aria-pressed={filter === 'saved'} className={filter === 'saved' ? 'selected' : ''} disabled={busy} onClick={() => setFilter('saved')}>담은 혜택 <span>{saved.length}</span></button></div><div className="results-view-actions"><p>{filter === 'saved' ? '상담 중 담은 혜택 전체' : `전체 ${displayResults.total.toLocaleString()}개 중 이번 페이지 ${displayResults.items.length}개`}</p>{filter !== 'saved' && <ResultsPagination page={results.page} pages={results.pages} busy={busy} onPage={page => findBenefits(page, includeClosed, filter)} />}</div></div>
          <div className="benefits-grid">{visible.map(benefit => <BenefitCard key={benefit.id} benefit={benefit} saved={saved.some(item => item.id === benefit.id)} onSave={() => setSaved(saved.some(item => item.id === benefit.id) ? saved.filter(item => item.id !== benefit.id) : [...saved, benefit])} />)}</div>
          {!visible.length && <div className="empty-state"><BookOpen size={27} /><h3>{filter === 'saved' ? '아직 담은 혜택이 없어요' : '이 목록에서는 관련 제도를 찾지 못했어요'}</h3><p>{filter === 'saved' ? '관심 있는 혜택의 담기 버튼을 눌러 주세요.' : '혜택이 없다는 뜻은 아니에요. 복지로에서 더 넓게 확인할 수 있어요.'}</p><button disabled={busy} onClick={() => findBenefits(1, includeClosed, 'all')}>전체 결과 보기</button></div>}
          <div className="results-bottom-bar"><span>{filter === 'saved' ? '현재 입력조건으로 다시 비교한 담은 혜택입니다.' : '페이지당 30개씩 확인할 수 있어요.'}</span>{filter !== 'saved' && <ResultsPagination page={results.page} pages={results.pages} busy={busy} onPage={page => findBenefits(page, includeClosed, filter)} />}</div>
          </section>
          <aside className="source-summary"><h3>추가 정부사업 확인</h3><p>추가 수집 채널 {catalog.channelCoverage?.length || 0}곳 · {catalog.additionalCount?.toLocaleString() || 0}건. 아래는 공식 원문 검색 경로이며, 채널별 범위는 데이터 출처에서 확인하세요.</p><div className="results-filters">{EXTRA_SOURCES.filter(source => !topics.length || source.topics.some(topic => topics.includes(topic))).map(source => <a key={source.title} href={source.url} target="_blank" rel="noreferrer noopener">{source.title} ↗</a>)}</div></aside><p className="results-footnote">자료 수집일 {catalog.checkedAt} · {catalog.mode === 'api-snapshot' ? '복지 API 수집 스냅샷' : '수동 요약 목록 · 복지 API 미연동'} <button onClick={() => setDialog('sources')}>출처 확인<ArrowUpRight size={13} /></button></p>
        </section> : <><Steps />{stage === 'intro' && catalog && <section className="preview-section"><div className="preview-heading"><h2>추천은 이렇게 보여드려요</h2><span>아래는 개인 추천이 아닌 안내 예시예요</span></div><div className="benefits-grid">{(catalog.previews || []).map(benefit => <BenefitCard key={benefit.id} benefit={benefit} preview />)}</div></section>}</>}
        </>}<footer className="page-footer"><span>온혜와 함께, 필요한 지원에 한 걸음 더.</span><button onClick={() => setDialog('help')}>이용 안내<ArrowUpRight size={13} /></button></footer>
      </main>
    </div>
    {dialog && <Dialog kind={dialog} onClose={() => setDialog(null)} catalog={catalog} status={status} />}
  </div>;
}
