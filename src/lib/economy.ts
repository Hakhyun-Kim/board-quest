// 원정 경제 상수 — 단일 출처. UI(App·TownScreen)와 시뮬레이터가 같은 값을 쓴다.
// 이 숫자를 바꾸면 반드시 `__bqsim.campaign()`으로 완주율·영입율을 다시 잰다.

export const START_GOLD = 60;
export const HEAL_COST = 30; // 여관 완전 회복
export const RECRUIT_COST = 60; // 동료 영입 (90 → 60). 75 이상이면 마을에 닿고도 못 뽑아 영입율이 급락한다(측정)
export const PARTY_MAX = 4;
