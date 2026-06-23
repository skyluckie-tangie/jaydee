# Jaydee — Cloud Collaborative DAW

온라인에서 친구와 함께 실시간으로 작곡할 수 있는 클라우드 DAW입니다.
초보자 친화적으로 단계별로 만들어 갑니다.

**현재 단계**: Phase 3 진행 — MIDI + Piano Roll + Subtractive Synth 구현 완료 (타임라인 MIDI 클립 표시, 편집, 재생)

## 빠른 시작

```bash
npm install
npm run dev
```

개발 서버가 열리면 브라우저에서 DAW 레이아웃을 볼 수 있습니다.
- Transport (재생/정지 + BPM 조절) — 클릭으로 토글
- 트랙 목록 + 플레이스홀더 타임라인 + 믹서

## 기술 스택 (승인된 계획에 따름)

- **Frontend**: Vite + React + TypeScript + Tailwind
- **State**: Zustand
- **Realtime / Cloud**: Supabase (Auth + Postgres + Storage + Realtime)
- **Audio**: Web Audio API + AudioWorklet (Phase 1부터 본격)
- **MIDI + Synth**: Web MIDI API + custom subtractive synth
- **UI**: Canvas 기반 Timeline & Piano Roll

전체 계획과 단계별 상태는 `HANDOFF.md`를 참조하세요. (plan.md는 더 이상 사용되지 않습니다.)

## 개발 로드맵 (요약)

- **Phase 0** (완료): 프로젝트 세팅 + 기본 DAW 레이아웃
- **Phase 1**: AudioEngine + beat scheduler + 오디오 클립 재생 (기본 데모 사운드 + 드래그 편집 + 단축키 + ruler seek 구현됨)
- **Phase 2**: 멀티트랙 + 드래그/트림 편집
- **Phase 3**: MIDI + Piano Roll + 간단 Subtractive Synth
- **Phase 4**: Mixer + 첫 custom FX (AudioWorklet로 Dynamics 구현)
- **Phase 5**: Supabase 로그인 + 프로젝트 저장 + 실시간 협업
- **Phase 6**: Cubase-like UX 완성, 내보내기 등

## 중요한 원칙

- 항상 **작동하는 상태**를 유지하세요.
- Audio / MIDI / FX는 먼저 **로컬**에서 완성한 후 realtime을 붙입니다.
- 2인 실시간 협업이 목표이지만, 복잡하니 단계적으로 접근.

자세한 계획과 현재 단계는 `HANDOFF.md`를 참고하세요.

행운을 빕니다! 🎹


See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
