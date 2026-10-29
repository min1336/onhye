import { reportClientError } from './telemetry.mjs';
import { useEffect, useState } from 'react';
import { BenefitCard, REGIONS, TOPICS } from './components.jsx';

export default function Catalogue({ catalog }) {
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState('all');
  const [region, setRegion] = useState('all');
  const [agency, setAgency] = useState('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [listing, setListing] = useState(null);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setListError('');
    const timer = setTimeout(() => fetch(`/api/catalog?${new URLSearchParams({ q: query, topic, region, agency, page })}`, { signal: controller.signal }).then(async response => {
      if (!response.ok) { const error = new Error('목록을 불러오지 못했어요.'); error.requestId = response.headers.get('x-request-id'); throw error; }
      const data = await response.json();
      if (!controller.signal.aborted) setListing(data);
    }).catch(error => { if (!controller.signal.aborted) { reportClientError('catalogue_error', '/api/catalog', error.requestId); setListError(error.message); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); }), 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, topic, region, agency, page, retry]);
  const matches = listing?.items || [];
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    setError(''); setDetail(null);
    fetch(`/api/benefit?${new URLSearchParams({ id: selected })}`, { signal: controller.signal }).then(async response => {
      if (!response.ok) { const error = new Error('상세 안내를 불러오지 못했어요. 다시 선택해 주세요.'); error.requestId = response.headers.get('x-request-id'); throw error; }
      const item = await response.json();
      if (!controller.signal.aborted) setDetail(item);
    }).catch(error => { if (!controller.signal.aborted) { reportClientError('detail_error', '/api/benefit', error.requestId); setError(error.message); } });
    return () => controller.abort();
  }, [selected]);
  const change = setter => event => { setter(event.target.value); setPage(1); setSelected(null); };
  const pages = listing?.pages || 1;
  return <section className="catalogue" aria-label="전체 제도·공고 검색">
    <h1>전체 제도·공고 찾아보기</h1>
    <p>공식 채널 수집본 <strong>{catalog?.count?.toLocaleString() || 0}개</strong> <span className="catalogue-date">· 수집일 {catalog?.checkedAt}</span></p>
    <p className="catalogue-note">검색 결과는 개인 맞춤 추천이나 신청 가능 판정이 아닙니다. 기관 지역 필터는 소관기관 소재 범위를 뜻하며, 실제 거주조건·신청기한은 상세 안내에서 확인하세요.</p>
    <div className="catalogue-filters">
      <label className="catalogue-query">제도명·기관·요약 검색<input type="search" value={query} onChange={change(setQuery)} placeholder="예: 청년 월세, 장학금, 장애인" /></label>
      <label>분야<select value={topic} onChange={change(setTopic)}><option value="all">전체 분야</option>{Object.entries(TOPICS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
      <label>기관 지역<select value={region} onChange={change(setRegion)}><option value="all">전체 지역</option>{REGIONS.map(region => <option key={region}>{region}</option>)}</select></label>
      <label>기관 유형<select value={agency} onChange={change(setAgency)}><option value="all">전체 기관</option>{(catalog?.agencyTypes || []).map(type => <option key={type}>{type}</option>)}</select></label>
    </div>
    <p className="catalogue-count" role="status">검색 결과 {(listing?.total || 0).toLocaleString()}개 · {page} / {pages}페이지</p>
    <div className="catalogue-list" aria-busy={loading}>{loading && <p role="status">검색 중…</p>}{listError && <p role="alert">{listError}<button onClick={() => setRetry(retry + 1)}>다시 시도</button></p>}{!loading && !listError && matches.map(item => <div key={item.id} className="catalogue-entry">
      <div className="catalogue-row"><div><p className="catalogue-meta">{item.accepting === false ? '모집 종료 · ' : item.accepting === true ? '수집 시 모집 중 · ' : ''}{item.field || TOPICS[item.category]} · {item.agencyType}{item.region ? ` · ${item.region}` : ''}</p><h2>{item.title}</h2><p>{item.summary}</p><small>{item.agency}</small></div><button className="outline-button" aria-expanded={selected === item.id} onClick={() => setSelected(selected === item.id ? null : item.id)}>{selected === item.id ? '상세 닫기' : '상세 보기'}</button></div>
      {selected === item.id && <div className="catalogue-detail">{error ? <p role="alert">{error}</p> : detail?.id === selected ? <BenefitCard benefit={detail} /> : <p role="status">상세 안내를 불러오고 있어요…</p>}</div>}
    </div>)}</div>
    {!loading && !listError && !matches.length && <p className="empty-state">검색어 또는 필터를 바꿔보세요. 검색 결과가 없다고 받을 수 있는 혜택이 없다는 뜻은 아닙니다.</p>}
    <nav className="catalogue-pagination" aria-label="전체 제도·공고 페이지"><button className="outline-button" disabled={loading || page <= 1} onClick={() => { setPage(page - 1); setSelected(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>이전</button><span>{page} / {pages}</span><button className="outline-button" disabled={loading || page >= pages} onClick={() => { setPage(page + 1); setSelected(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>다음</button></nav>
  </section>;
}
