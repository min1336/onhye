import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, ChevronDown, ChevronRight, Clipboard, ExternalLink, HeartHandshake, Info, LockKeyhole, X } from 'lucide-react';

import { TOPICS, REGIONS } from '../shared/topics.mjs';
export { TOPICS, REGIONS };
export { EMPTY_PROFILE } from '../shared/profile.mjs';
import { EXTRA_SOURCES } from '../shared/sources.mjs';
import { SPECIAL, MONEY } from '../shared/profile.mjs';

export function BrandMark({ small = false }) {
  return <span className={`brand-mark ${small ? 'small' : ''}`} aria-hidden="true"><span /><span /><span /><span /></span>;
}

export function ProfileForm({ topics, setTopics, profile, setProfile, onSubmit, busy }) {
  const [error, setError] = useState('');
  return <form className="profile-form" onSubmit={event => {
    event.preventDefault();
    if (profile.district.trim() && profile.region === 'unknown') { setError('시·군·구를 입력했다면 거주 시·도도 선택해 주세요.'); return; }
    setError(''); onSubmit();
  }}>
    <div className="form-heading"><h3>추천 전에, 조금만 확인할게요.</h3><span>다른 사람·과거 상황·충돌하는 정보는 비워둡니다. 지원받을 분 기준으로 확인하세요.</span></div>
    <fieldset id="profile-topics" tabIndex={-1} className="topics-field"><legend>찾아볼 분야 <span>미선택 시 전체 분야</span></legend><div className="topic-choices">{Object.entries(TOPICS).map(([key, label]) => <button key={key} type="button" aria-pressed={topics.includes(key)} onClick={() => setTopics(topics.includes(key) ? topics.filter(t => t !== key) : [...topics, key])} className={topics.includes(key) ? 'selected' : ''}>{topics.includes(key) && <Check size={14} />}{label}</button>)}</div></fieldset>
    <div className="profile-grid">
      <label>누구를 위한 혜택인가요?<select value={profile.subject} onChange={e => setProfile({ ...profile, subject: e.target.value })}><option value="self">나를 위해 찾고 있어요</option><option value="family">가족을 위해 찾고 있어요</option></select></label>
      <label>지원받을 분의 만 나이 <span className="optional">선택</span><div className="age-input"><input id="profile-age" aria-label="지원받을 분의 만 나이" type="number" min="0" max="120" step="1" placeholder="모르면 비워두세요" value={profile.age ?? ''} onChange={e => setProfile({ ...profile, age: e.target.value === '' ? null : Number(e.target.value) })} /><span>세</span></div></label>
      <label>거주지역 <span className="optional">선택</span><select id="profile-region" value={profile.region} onChange={e => setProfile({ ...profile, region: e.target.value, district: '' })}><option value="unknown">아직 입력하지 않을게요</option>{REGIONS.map(region => <option key={region}>{region}</option>)}</select></label>
      <label>현재 취업상태 <span className="optional">선택</span><select id="profile-employment" value={profile.employment} onChange={e => setProfile({ ...profile, employment: e.target.value })}><option value="unknown">아직 입력하지 않을게요</option><option value="seeking">구직·취업 준비 중</option><option value="employed">재직·근로 중</option><option value="student">학생</option><option value="other">그 외</option></select></label>
      <label>성별<select value={profile.sex} onChange={e => setProfile({ ...profile, sex: e.target.value })}><option value="unknown">입력하지 않음</option><option value="male">남성</option><option value="female">여성</option></select></label>
      <label>거주 시·군·구<input id="profile-district" maxLength={40} placeholder="예: 수원시 · 상세주소 제외" value={profile.district} onChange={e => setProfile({ ...profile, district: e.target.value })} /></label>
      {(topics.length === 0 || topics.includes('business')) && <><label>사업장 소재 시·도<select value={profile.businessRegion || 'unknown'} onChange={e => setProfile({ ...profile, businessRegion: e.target.value, businessDistrict: '' })}><option value="unknown">모름 · 미입력</option>{REGIONS.map(region => <option key={region}>{region}</option>)}</select></label><label>사업장 시·군·구<input maxLength={40} value={profile.businessDistrict || ''} onChange={e => setProfile({ ...profile, businessDistrict: e.target.value })} placeholder="상세주소 제외" /></label></>}
      {(topics.length === 0 || topics.some(topic => ['family', 'care', 'health', 'education'].includes(topic))) && <label>함께 찾는 아이의 만 나이 <span className="optional">선택 · 부모 나이와 구분</span><input id="profile-childAge" type="number" min="0" max="17" value={profile.childAge ?? ''} onChange={e => setProfile({ ...profile, childAge: e.target.value === '' ? null : Number(e.target.value) })} /></label>}
      {topics.includes('housing') && <label>어떤 주거 도움이 필요한가요?<select id="profile-housingGoal" value={profile.housingGoal || 'unknown'} onChange={e => setProfile({ ...profile, housingGoal: e.target.value })}><option value="unknown">아직 모르겠어요</option><option value="rent">월세 부담</option><option value="deposit">전세·임대 보증금</option><option value="buy">주택 구입</option></select></label>}
    </div>
    <fieldset className="topics-field"><legend>특수상황·가구 특성 <span>해당하는 것만 선택</span></legend><div className="topic-choices">{Object.entries(SPECIAL).map(([key, label]) => <button type="button" key={key} aria-pressed={profile.special.includes(key)} className={profile.special.includes(key) ? 'selected' : ''} onClick={() => setProfile({ ...profile, special: profile.special.includes(key) ? profile.special.filter(x => x !== key) : [...profile.special, key] })}>{label}</button>)}</div></fieldset>
    <div className="profile-grid"><label>가구원 수<input id="profile-householdSize" type="number" min="1" max="99" value={profile.householdSize ?? ''} onChange={e => setProfile({ ...profile, householdSize: e.target.value === '' ? null : Number(e.target.value) })} /></label><label>기초생활수급·차상위 여부<select id="profile-recipient" value={profile.recipient} onChange={e => setProfile({ ...profile, recipient: e.target.value })}><option value="unknown">모름 · 미입력</option><option value="basic">기초생활수급</option><option value="near">차상위</option><option value="none">둘 다 해당 없음</option></select></label></div>
    <label className="crisis-field">실직·질병 등 생계 위기상황 <span className="optional">선택 · 공식 위기사유는 별도 확인</span><select id="profile-crisis" value={profile.crisis} onChange={e => setProfile({ ...profile, crisis: e.target.value })}><option value="unknown">모름 · 미입력</option><option value="yes">위기상황이 있어요</option><option value="no">해당하지 않아요</option></select></label>
    <details><summary>소득·보유금액 입력 (선택)</summary><p>금액 단위는 원입니다. 모르면 비워두세요. 0원과 미입력은 구분합니다. 입력 금액만으로 자격을 확정하지 않습니다.</p><div className="profile-grid">{Object.entries(MONEY).map(([key, label]) => <label key={key}>{label} (원)<input type="number" min="0" max="1000000000000000" step="1" value={profile[key] ?? ''} placeholder="미입력" onChange={e => setProfile({ ...profile, [key]: e.target.value === '' ? null : Number(e.target.value) })} /></label>)}<label>알고 있는 기준중위소득 구간<select id="profile-incomeBracket" value={profile.incomeBracket} onChange={e => setProfile({ ...profile, incomeBracket: e.target.value })}><option value="unknown">모름 · 금액으로 추정하지 않음</option>{['50% 이하', '51~75%', '76~100%', '101~200%', '200% 초과'].map((label, i) => <option key={label} value={`JA020${i + 1}`}>{label}</option>)}</select></label></div><label className="consent"><input type="checkbox" checked={profile.amountsAssessed} onChange={e => setProfile({ ...profile, amountsAssessed: e.target.checked })} />가구 월소득·가구 금융재산을 서울형 긴급복지의 기관 산정 기준으로 확인했습니다.</label><p>금액 비교는 검증한 2026년 서울형 긴급복지 1인 가구 기준에 한정됩니다. 다른 제도와 미확인 산정액은 별도 확인으로 남깁니다.</p></details>
    <p className="form-note"><Info size={14} /> 입력값은 이번 상담에서만 사용합니다. 조건이 맞는 후보를 먼저 보여주고, 정보가 부족한 후보도 확인할 수 있어요.</p>
    {error && <p role="alert" className="error-message">{error}</p>}
    <button className="primary-button" disabled={busy} type="submit">{busy ? '안내를 찾고 있어요…' : '이 조건으로 혜택 찾아보기'}<ArrowUpRight size={18} /></button>
  </form>;
}

export function BenefitCard({ benefit, preview = false, compact = false, saved, onSave }) {
  const [expanded, setExpanded] = useState(false);
  return <article className={`benefit-card ${preview ? 'preview' : ''} ${compact ? 'priority-card' : ''} ${!preview && benefit.group === 'matched' ? 'is-match' : ''}`}>
    <div className="benefit-top"><span className="category-label">{TOPICS[benefit.category]}</span>{!preview && onSave && <button className={`save-button ${saved ? 'is-saved' : ''}`} aria-label={`${benefit.title} ${saved ? '담기 취소' : '비교 목록에 담기'}`} aria-pressed={saved} onClick={onSave}>{saved ? <Check size={15} /> : <Clipboard size={15} />}{saved ? '담았어요' : '담기'}</button>}</div>
    <h3>{benefit.title}</h3>
    <p className="benefit-summary">{benefit.summary}</p>
    {!preview && <>{benefit.reason && <p className="recommend-reason"><HeartHandshake size={17} />{benefit.reason}</p>}
      {!!benefit.matched?.length && <ul>{(compact ? benefit.matched.slice(0, 2) : benefit.matched).map(match => <li key={match}>{match}</li>)}</ul>}{!compact && <div className="benefit-support"><h4>어떤 지원인가요?</h4><p>{benefit.support || '지원내용은 공식 안내에서 확인해 주세요.'}</p></div>}
      {compact && benefit.programGuide && <div className="verification-questions"><strong>신청 전에 확인할 것</strong><ol>{benefit.programGuide.questions.map(question => <li key={question}>{question}</li>)}</ol><small>수집본 대상조건 검토 {benefit.programGuide.reviewedAt} · 자격 판정 아님</small></div>}
      {compact && benefit.target && <details className="source-evidence"><summary>공식 대상조건 원문</summary><p>{benefit.target}</p>{benefit.criteria && <p>{benefit.criteria}</p>}</details>}
      {!!benefit.missing?.length && <div className="age-note"><strong>먼저 확인할 조건</strong><ul>{(compact ? benefit.missing.slice(0, 2) : benefit.missing).map(text => <li key={text}>{text}</li>)}</ul></div>}{benefit.ruleSource && <a href={benefit.ruleSource} target="_blank" rel="noreferrer noopener">금액 비교 근거 · 2026년 공식 안내 ↗</a>}
      {benefit.sourceId === 'arko' && <p className="form-note">공공·민간 공모가 혼합된 채널입니다. 주최기관을 확인하세요.</p>}{benefit.contentLevel === 'public-list' && <p className="form-note">공개 목록에서 수집했습니다. 상세 본문·첨부 조건은 공식 원문 확인이 필요합니다.</p>}{!!benefit.attachments?.length && <details><summary>공식 첨부파일 {benefit.attachments.length}개 (내용 미해석)</summary>{benefit.attachments.map((url, index) => <p key={url}><a href={url} target="_blank" rel="noreferrer noopener">첨부파일 {index + 1} ↗</a></p>)}</details>}
      {!compact && !!benefit.notes?.length && <div className="age-note">{benefit.notes.map(note => <p key={note}>{note}</p>)}</div>}
      <button className="details-toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>선정조건·신청방법 확인<ChevronDown className={expanded ? 'rotated' : ''} size={16} /></button>
      {expanded && <div className="benefit-details"><h4>지원내용 전체</h4><p>{benefit.support || '공식 안내에서 확인해 주세요.'}</p><h4>공식 안내에서 확인할 조건</h4><p>{benefit.target || '지원대상은 공식 안내에서 확인해 주세요.'}</p>{benefit.criteria && <p>{benefit.criteria}</p>}<ul>{benefit.checks.map(check => <li key={check}>{check}</li>)}</ul><h4>신청 안내</h4><p>{benefit.application || '신청방법은 공식 안내에서 확인해 주세요.'}</p>{benefit.deadline && <><h4>신청기한</h4><p>{benefit.deadline}</p></>}{benefit.reception && <p>접수기관: {benefit.reception}</p>}<p className="contact-text">{benefit.contact}</p>{benefit.updatedAt && <p>제공기관 수정일: {benefit.updatedAt.slice(0, 4)}-{benefit.updatedAt.slice(4, 6)}-{benefit.updatedAt.slice(6, 8)}</p>}</div>}
    </>}
    <footer><span>{benefit.agency}</span><a href={benefit.url} target="_blank" rel="noreferrer noopener">공식 안내<ArrowUpRight size={15} /><span className="sr-only"> (새 창)</span></a></footer>
  </article>;
}

export function Steps() {
  return <section className="steps-section" aria-label="혜택 탐색 순서"><h2>이렇게 찾아드려요</h2><div className="steps">{[
    ['상황 이해', '지금의 고민에서 관심 분야를 찾아요.'],
    ['필요한 정보 확인', '아는 정보만 입력하고 조건을 확인해요.'],
    ['혜택과 신청 방법', '공식 근거와 신청 경로를 함께 살펴요.'],
  ].map(([title, text], i) => <div className="step" key={title}><span className="step-number">{i + 1}</span><div><h3>{title}</h3><p>{text}</p></div>{i < 2 && <ChevronRight className="step-arrow" size={20} />}</div>)}</div></section>;
}

export function Dialog({ kind, onClose, catalog, status }) {
  const ref = useRef(null);
  useEffect(() => { const element = ref.current; element.showModal(); return () => element.close(); }, []);
  return <dialog ref={ref} aria-labelledby="info-dialog-title" onCancel={onClose} onClick={e => { if (e.target === ref.current) onClose(); }} className={`info-dialog ${kind === 'sources' ? 'sources-dialog' : ''}`}><div className="dialog-inner"><header><h2 id="info-dialog-title">{kind === 'sources' ? '데이터 출처' : '온혜 이용 안내'}</h2><button className="icon-button" aria-label="닫기" onClick={onClose}><X size={22} /></button></header>
    {kind === 'sources' ? <>
      <p>공식 채널에서 수집한 <strong>{catalog?.count?.toLocaleString() || 0}개 제도·공고</strong>를 함께 살펴보세요. 실시간 자격 조회 결과는 아닙니다.</p>
      <div className="source-overview">
        <div><span>정부24 제도</span><strong>{catalog?.coverage?.imported?.toLocaleString() || '—'}<small>개</small></strong></div>
        <div><span>K-Startup 공고</span><strong>{catalog?.announcementCoverage?.imported?.toLocaleString() || '—'}<small>개</small></strong></div>
        <div><span>추가 공식 채널</span><strong>{catalog?.additionalCount?.toLocaleString() || '0'}<small>건</small></strong></div>
      </div>
      <h3>채널별 수집 범위</h3>
      <p>종료 공고도 포함하며, 채널 간 중복이 있을 수 있습니다. K-Startup에서 수집 시 모집 중인 공고는 {catalog?.announcementCoverage?.accepting?.toLocaleString() || 0}개입니다.</p>
      <ul className="source-channels">{EXTRA_SOURCES.map(source => {
        const coverage = source.title === 'K-Startup' && catalog?.announcementCoverage
          ? { ...catalog.announcementCoverage, scope: source.status }
          : catalog?.channelCoverage?.find(row => row.title === source.title);
        return <li key={source.title}>
          <div className="source-channel-heading"><a href={source.url} target="_blank" rel="noreferrer noopener">{source.title}<ArrowUpRight size={15} /><span className="sr-only"> (새 창)</span></a><span className={`source-coverage ${coverage?.complete ? 'complete' : ''}`}>{coverage ? coverage.complete ? '범위 내 건수 검증' : '완전성 확인 필요' : '수집 상태 확인'}</span></div>
          {coverage ? <><strong className="source-channel-count">{coverage.imported.toLocaleString()}<small>건 수집</small></strong><p>{coverage.scope}</p><span className="source-channel-date">수집일 {coverage.checkedAt?.slice(0, 10) || '확인 필요'}</span></> : <p>{source.status}</p>}
        </li>;
      })}</ul>
      <div className="source-summary"><div>수집 기준일 <strong>{catalog?.checkedAt || '불러오는 중'}</strong></div><div>정부24 전체 수집 <strong>{catalog?.coverage?.complete ? `${catalog.coverage.imported.toLocaleString()} / ${catalog.coverage.expected.toLocaleString()}개` : '확인 필요'}</strong></div><div>Gemini <strong>{status?.geminiConfigured ? 'Google Cloud 서버 설정 완료' : '연결 대기 · 체험 가능'}</strong></div></div>
      <p className="source-disclaimer">정부24 전체 수집은 정부24 목록에 한정합니다. 공개 목록 수집은 첨부 조건 전체 해석이나 최종 자격 판정을 뜻하지 않습니다.</p>
      <h3>정부24 기관별 구성</h3>
      <ul className="source-list">{Object.entries(catalog?.coverage?.agencyCounts || {}).map(([agency, count]) => <li key={agency}><span>{agency}</span><strong>{count.toLocaleString()}개</strong></li>)}</ul>
      <a className="source-portal" href={catalog?.sourceUrl || 'https://www.data.go.kr/data/15113968/openapi.do'} target="_blank" rel="noreferrer noopener">공공서비스(혜택) API 확인하기 <ArrowUpRight size={16} /></a>
    </> : <><p>온혜는 내 상황과 관련된 복지제도를 찾아보는 시제품입니다. 받을 수 있는 혜택과 지급액을 확정하거나 신청을 대신하지 않습니다.</p><h3>모르는 조건은 그대로 남겨요</h3><p>개인소득이 없다고 가구소득도 없다고 판단하지 않습니다. 소득·재산·중복지원 등은 담당기관에서 확인해 주세요.</p><h3>입력은 꼭 필요한 만큼만</h3><p>이름·주민등록번호·계좌번호·상세주소를 입력하지 마세요. 상담은 브라우저 메모리에서만 유지되며 새 상담이나 새로고침으로 지워집니다. 서버는 상황 설명을 저장하지 않습니다.</p><h3>체험과 실제 AI는 구분해요</h3><p>현재 체험 모드는 단순 키워드로 관심 분야를 제안합니다. Gemini 모드에서는 동의한 상황 설명이 Google Cloud에 전송됩니다. 확인 화면의 상세 조건은 Gemini에 보내지 않습니다. 상황 설명의 금액 표현은 전송 전에 가립니다.</p><h3>급한 도움이 필요하다면</h3><p>복지 상담은 <a href="tel:129">129</a>, 고용 상담은 <a href="tel:1350">1350</a>에서 확인하세요.</p></>}
    <button className="primary-button dialog-close" onClick={onClose}>확인했어요<Check size={16} /></button></div></dialog>;
}

export function PrivacyNote() { return <p className="privacy-note"><LockKeyhole size={14} /> 이름·주민번호 없이 시작해요. 상담 내용은 서버에 저장하지 않아요.</p>; }
