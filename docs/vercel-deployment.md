# 온혜 Vercel 운영

대표 주소: https://onhye.vercel.app
프로젝트: aldursjrnf123-4009s-projects/onhye

- Vite 정적 화면 + api/index.mjs의 Node 함수. HTTP 포트를 열지 않고 기존 API 처리기를 재사용한다.
- Google Cloud의 기존 프로젝트 gen-lang-client-0179618980 사용. 서비스 계정 onhye-vercel은 Vertex 예측 및 호출 집계에 필요한 권한만 가진다. 장기 서비스 계정 키나 로컬 ADC를 업로드하지 않았다.
- Vercel OIDC→Google Workload Identity Federation으로 단기 인증한다. 해당 팀·onhye 프로젝트·production/preview 신원만 허용한다. 실제 환경 변수는 production에 설정했다.
- Firestore 기본 데이터베이스(서울)에 onhye_ai_guard/state 하나로 호출 예약을 공유한다. updateTime 사전조건으로 동시 갱신을 원자적으로 처리한다. 상담 원문·AI 답변을 저장하지 않는다. 새 호출을 정상 예약할 때 최근 3 UTC일의 HMAC 식별자·시각·완료 상태만 남긴다. 미사용 기간의 정시 삭제를 보장하지는 않는다.
- AI 한도: 익명 세션 3회/분·10회/UTC일, IP 20회/분, 전체 100회/UTC일. 동시 세션1·전체3개. 오류도 예약 수에 포함한다.
- BotID Basic을 클라이언트와 서버에 적용한다. 실제 브라우저 호출은 통과했고, 세션·CSRF만 갖춘 직접 HTTP 호출은 403으로 거부됐다. IP는 Vercel의 ipAddress()로 읽고 로컬 개발은 소켓 IP를 쓴다.
- 공유 저장소의 설정이나 연결이 실패하면 유료 호출을 허용하지 않는다. 무료 목록·직접 조건 검색은 유지한다. 일시적 외부 장애 때 AI 연결 표시만으로 실제 호출 성공을 보장하지는 않는다.

## 배포

```sh
vercel project inspect --non-interactive
npm run deploy
```

배포 전 테스트 성공을 확인한다. 다른 프로젝트·팀으로 연결돼 있으면 중단한다. 대표 주소가 자동으로 갱신되지 않았으면 검증한 새 배포 주소로 `vercel alias set <새배포주소> onhye.vercel.app`을 실행하고 실제 주소를 재확인한다.

.vercelignore는 웹·API 소스, 패키지 설정, 공개 데이터 압축본만 허용한다. 배포용 .deploy-data는 약18.3MiB이며 원본144,124건을 보존한다. 원본 data·조사 자료·.env·.private는 업로드하지 않는다. 비공개 파일이나 압축본은 공개 정적 경로로 제공되지 않는다.

## AI 긴급 중단·해제

운영자 로컬 ADC와 비공개 운영 설정 파일을 사용한다. 비밀 값은 출력하거나 채팅에 붙이지 않는다.

```sh
node --env-file=.private/onhye-cloud.env scripts/ai-control.mjs pause
node --env-file=.private/onhye-cloud.env scripts/ai-control.mjs resume
```

Firestore 중단 상태를 실제로 변경·해제해 검증했다. 이미 진행 중인 모델 요청까지 취소하지는 않는다. 로컬 SQLite를 제어하는 기본 실행과 공개 서버 제어를 혼동하지 않는다.

## 검증·기록

기존 테스트와 공유 저장소 회귀 테스트 61개가 통과했다. 실제 브라우저에서 취업·주거·의료 관심 분류를 확인했으며 최종 공개 버전의 취업 분류도 재확인했다. 대표 주소의 상태 API200, 직접 자동 요청403, 비공개 경로404를 확인했다.

첫 검증 배포의 소스 아카이브에 하위 제외 패턴이 적용되지 않아 로컬 상태 파일이 들어갔다. 그 배포는 삭제했고 로컬·공개 익명 서명키를 교체했다. 수정한 허용 목록으로 만든 배포 아카이브43항목에는 비밀·로컬 DB·원본 data·조사자료가 없는 것을 확인했다. 로컬 ADC는 처음부터 프로젝트 바깥에 있어 업로드하지 않았다.

실제 AI와 Firestore 사용량은 기존 Google Cloud 결제 계정에 반영된다. 요청 수 제한은 원화 청구액 상한이 아니다. 별도 유료 플랜 구매나 결제 방식 변경은 하지 않았다. 대규모 부하 시험·월간 Cloud Spendcap은 별도로 확인해야 한다.

구성 근거: [Vercel Google Cloud OIDC](https://vercel.com/docs/oidc/gcp), [BotID](https://vercel.com/docs/botid/get-started), [Node.js Functions](https://vercel.com/docs/functions/runtimes/node-js).

배포 데이터는 수집 명령 성공 후 자동 재생성하고 로컬 빌드에서도 재생성한다. 배포는 `npm run deploy`를 사용한다. Vercel 빌드는 업로드된 압축본과 채널 목록을 SHA-256으로 검증하며, 검증 실패 시 빌드를 중단한다. `node scripts/pack-deployment.mjs --verify`로 로컬 원본과도 비교할 수 있다.

공개 검색은 IP의 HMAC을 문서 ID로 사용해 Firestore에서 분당 전체 120회·경로당 60회를 공유 제한한다. 저장소 장애 시 보호 대상 검색은 503으로 중단하며 상태·메타데이터는 유지한다. `onhye_rate_limits.expiresAt` TTL은 `node --env-file-if-exists=.env.local scripts/setup-rate-limit-ttl.mjs`로 설정한다. 만료 시각은 마지막 사용 후 24시간이며 실제 삭제 시점은 Firestore TTL 처리 지연에 따른다. 추천 캐시는 인스턴스 메모리에서 30초·최대 2개 조건 조합이며 디스크나 외부 저장소에 프로필을 기록하지 않는다.
