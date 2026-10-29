import { useEffect, useRef, useState } from 'react';

let scriptReady;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve();
  if (!scriptReady) scriptReady = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true; script.onload = resolve; script.onerror = reject;
    document.head.append(script);
  }).catch(error => { scriptReady = null; throw error; });
  return scriptReady;
}

export default function BotCheck({ siteKey, nonce, onToken }) {
  const container = useRef(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false, widget;
    setFailed(false); onToken('');
    loadTurnstile().then(() => {
      if (cancelled) return;
      widget = window.turnstile.render(container.current, { sitekey: siteKey, action: 'benefit_analyze', callback: onToken, 'expired-callback': () => onToken(''), 'error-callback': () => { onToken(''); setFailed(true); } });
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; if (widget !== undefined) window.turnstile?.remove(widget); };
  }, [siteKey, nonce, onToken]);
  return <div><div ref={container} />{failed && <p role="alert">봇 방지 확인을 불러오지 못했어요. 직접 분야를 선택해서 계속할 수 있어요.</p>}</div>;
}
