# 포켓파티 랩 (PokéParty Lab)

포켓몬 이름만 입력하면 **약점 타입**을 알려주고, 내 포켓몬을 넣으면 **타입 상성 + 실전 사용률 데이터**로 나머지 파티를 추천해 주는 웹 서비스입니다.
하드코딩된 포켓몬 정보 없이, 공개 데이터베이스에서 받아온 데이터만 사용합니다.

## 기능

| 화면 | 내용 |
| --- | --- |
| **상성 탐색** | 한글·영문·초성(`ㄹㅈㅁ`)·도감번호 검색 → 받는 데미지 배율(×4 ~ ×0), 특성(부유·저수 등)·테라스탈 반영, 자속 공격 상성, 상성으로 잡기 좋은 포켓몬, 내 파티 대면 결과, 실전 세팅(기술·도구·성격·동료·카운터) |
| **파티 추천** | 내 포켓몬을 넣고 *빈 슬롯 자동 추천* → 약점 겹침·공격 커버리지·실전 동료 사용률을 따져 빔 서치로 채움. 추천 이유, 슬롯별 대안 후보, 잠금, 종합 등급(S~D), 진단, 방어 상성표, 공유 링크 |
| **타입 상성표** | 18×18 상성표, 타입 조합 계산기 |

데이터 기준(상단 선택): `챔피언스 싱글` · `챔피언스 더블(VGC)` · `SV 싱글 OU` 실전 통계, 또는 `타입 상성만(전체 도감)`.

## 데이터 출처

- **[PokeAPI](https://github.com/PokeAPI/pokeapi)** `data/v2/csv` — 포켓몬 1025종 + 폼, 한국어 이름, 타입, 종족값, 특성, 타입 상성표, 게임별 도감
- **[Smogon 사용률 통계](https://www.smogon.com/stats/)** — 최신 월의 기술·도구·특성·성격·테라·동료·카운터 사용률 (한국어로 변환)
- 이미지: [PokeAPI/sprites](https://github.com/PokeAPI/sprites)

`scripts/build-pokedex.mjs`, `scripts/build-usage.mjs` 가 위 데이터를 받아 `site/data/*.json` 을 만듭니다.
GitHub Actions 가 매월 자동으로 데이터를 갱신하고 다시 배포합니다.

## 로컬 실행

Node.js 20 이상 필요 (외부 패키지 없음).

```bash
npm run data   # 데이터 새로 받기 (선택, 이미 site/data 에 포함됨)
npm test       # 상성·추천·검색 테스트
npm run dev    # http://localhost:5173
```

## 배포

`main` 에 push 하면 `.github/workflows/deploy.yml` 이 테스트 후 `site/` 를 GitHub Pages 로 배포합니다.
Actions 탭의 *Run workflow* 로 데이터 갱신 + 재배포를 수동 실행할 수도 있습니다.

## 구조

```
site/                 정적 웹사이트 (GitHub Pages 배포 대상)
  index.html
  assets/css/style.css
  assets/js/core/     상성 엔진 · 파티 분석/추천 · 검색 (브라우저/Node 공용)
  assets/js/views/    상성 탐색 · 파티 추천 · 타입 상성표 화면
  data/               빌드된 데이터 (pokedex.json, usage/*.json)
scripts/              데이터 빌드 스크립트, 개발 서버
test/                 node:test 테스트
```

---
비공식 팬 프로젝트입니다. Pokémon 및 관련 명칭·이미지의 권리는 Nintendo · Creatures · GAME FREAK에 있습니다.
