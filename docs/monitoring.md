# 온혜 오류 기록과 모니터링

## 서버 기록

`server/observability.mjs`의 구조화 JSON 로그를 Vercel 런타임 로그에 남긴다.

- API 응답: 서버 발급 요청 UUID, 정해진 경로, 메서드, 응답 코드, 처리 시간.
- 검증 실패: 스키마 오류 코드와 허용된 필드 이름. 검색어·필드 값은 제외.
- 서버·AI·저장소 오류: 제한된 에러 종류, 자체 소스 파일명과 행/열, AI 제공업체 응답 코드.
- 초기화 실패와 공유 저장소 설정 실패도 기록한다.
- `X-Request-ID` 응답 헤더로 요청과 로그를 연결한다. 사용자가 준 요청 ID를 서버 추적 ID로 신뢰하지 않는다.

상담 원문·개인 프로필·검색어·전체 URL·쿠키·헤더·인증 정보·예외 메시지·원본 스택은 앱 로그에 넣지 않는다. Vercel 자체 접근 기록의 보관 정책은 별도다.

## 브라우저 기록

`src/telemetry.mjs`는 JS 오류, 처리되지 않은 Promise 오류, React 오류, 네트워크·응답 해석 실패와 목록/상세 실패를 `/api/client-events`로 보낸다.

전송값은 정해진 이벤트·API 경로·UUID·허용된 오류 종류·번들 파일명과 행/열뿐이다. 임의 메시지나 스택 문자열은 허용하지 않는다. 페이지 로드당 최대 5건, 서버 측 IP당 인스턴스별 분당 10회 제한과 출처 검증을 적용한다. 브라우저 보고는 신뢰되지 않은 관측값으로 취급하며 서버 장애 확정 근거로 단독 사용하지 않는다.

## 5분 간격 점검

macOS 사용자 LaunchAgent `com.onhye.monitor`를 등록했다. 로그인 후 실행되고, 실행 중에는 300초마다 점검한다. 절전·전원 꺼짐·로그아웃·인터넷 단절·CLI 인증 만료 중에는 정상 점검을 보장하지 못한다.

런타임은 Downloads의 권한 문제를 피하도록 아래 위치에 설치한다.

`~/Library/Application Support/OnhyeMonitor/`

- `scripts/monitor.mjs`, `shared/telemetry.mjs`: 설치한 실행 파일.
- `state/latest.json`: 가장 최근 결과.
- `state/checks.jsonl`: 점검 이력.
- `state/errors.jsonl`: Vercel에서 수집한 제한된 오류 메타데이터와 앱 이벤트.
- 이력은 각 파일 약4MiB에서 한 개의 이전 파일로 회전한다. 작업 디렉터리0700, 결과 파일0600.

무료 검사: HTML, 배포 JS 파일의 HEAD 응답, 상태 API의 준비 상태, 전체 목록 검색, 합성 프로필의 주거 추천. 유료 AI를 주기 호출하지 않는다. `geminiAvailable`은 준비 상태이며 실제 모델·Firestore의 성공 보장은 아니다.

최근10분의 4xx·5xx·오류 레벨 로그를 종류별 최대100건씩 가져온다. 중복 요청은 ID로 통합하고 처음 본 오류를 로컬에 추가한다. 접근 실패·조회 상한 도달·15분 이상 오래된 결과는 별도 표시/실패 코드로 드러낸다. 높은 트래픽에서 모든 로그의 영구 보관을 보장하는 로그 드레인은 아니다.

## 조회 명령

프로젝트 폴더에서:

```sh
npm run monitor:status
npm run monitor:once
node scripts/monitor.mjs --self-test
vercel logs --project onhye --environment production --no-branch --since 1h --limit 100 --json --scope aldursjrnf123-4009s-projects
vercel logs --project onhye --environment production --no-branch --request-id REQUEST_ID --since 1h --json --scope aldursjrnf123-4009s-projects
launchctl print gui/$(id -u)/com.onhye.monitor
```

`monitor:status`는 최근 결과와 오래됨 여부를 보여준다. `monitor:once`는 점검·오류 수집·이력 저장을 한 번 실행한다. 파일은 서버에 공개하지 않는다.

중지:

```sh
launchctl bootout gui/$(id -u) "$HOME/Library/LaunchAgents/com.onhye.monitor.plist"
```

다시 등록:

```sh
launchctl bootstrap gui/$(id -u) "$HOME/Library/LaunchAgents/com.onhye.monitor.plist"
```

소스의 모니터 코드를 바꾸면 설치본의 `scripts/monitor.mjs`와 `shared/telemetry.mjs`도 갱신해야 한다.

## 실제 발견 사례

전체 목록 검색이400을 반환했다. 구조화 로그에 `validation_failed`, `rewriteParameterPresent: true`, `unexpectedQueryCount: 1`, `unrecognized_keys`가 함께 기록됐다. Vercel이 자동 추가한 내부 `path` 쿼리가 엄격한 검색 스키마에 걸린 것이 확인됐다. Vercel 어댑터에서 실제 API 경로와 일치하는 단일 내부 캡처만 제거하도록 수정했다. 일반 알 수 없는 필드와 중복·불일치 path는 검증을 유지한다.

## 범위의 한계

현재 대화가 끝나도 백그라운드 스크립트는 실행되지만 AI 에이전트가 스스로 대화를 재개하거나 자동 수리하지는 않는다. 별도 이메일·메신저 알림은 설정하지 않았다. 다음 작업에서 위 상태·이력·Vercel 로그를 조회해 진단할 수 있다.

앱 스크립트가 실행되기 전의 장애, 오프라인 브라우저, 페이지 종료 시 전송 유실, Vercel 보관 기간·수집 상한 등으로 모든 오류의100% 수집은 보장할 수 없다. 소스맵은 공개하지 않으며 브라우저는 배포 번들 위치만 기록한다.

모니터 실행은 `state/monitor.lock` 디렉터리의 원자적 생성으로 직렬화한다. 중복 실행은 검사를 시작하지 않고 종료하며, 5분 이상 남은 잠금은 오류로 보고한다. 비정상 종료 후에는 모니터 프로세스가 없는지 확인한 뒤 해당 잠금 디렉터리만 제거한다. 상태 파일은 실행별 임시 파일을 작성한 뒤 원자적으로 교체한다.
