// 밸런스 시뮬레이터 — 전투를 헤드리스로 N판 굴려 승률·라운드 수·사망 분포를 잰다.
//
// 이 프로젝트의 기둥: 밸런스는 추측이 아니라 측정으로 정한다.
// battle.ts가 순수 함수라 렌더도 React도 없이 그대로 돌릴 수 있다.
//
// 쓰는 법
//  · 브라우저 콘솔:  __bqsim.start({ tier: 3, runs: 200 })
//                    __bqsim.sweep()            // 단계 1~8 한눈에
//  · 헤드리스(node): esbuild로 묶어 runSim()을 직접 호출 (docs/ROADMAP.md 참고)
import {
  createBattle,
  currentUnit,
  doMove,
  doPlannedAttack,
  doSkill,
  doWait,
  foeAct,
  healTargets,
  movesFor,
  reachableAttacks,
  skillOf,
  skillTargets,
  canUseSkill,
  type BattleState,
} from '../lib/battle';
import { dist } from '../lib/board';
import { buildEncounter } from '../lib/encounter';
import { makeUnit, type ClassId, type Unit } from '../lib/units';

export interface SimOptions {
  tier?: number; // 원정 단계 (난이도)
  runs?: number; // 반복 횟수
  seed?: number; // 시작 시드 (같은 시드 = 같은 결과)
  party?: ClassId[]; // 아군 편성
  level?: number; // 아군 레벨 (기본은 단계에 맞춰 자동)
  boss?: boolean;
  maxRounds?: number; // 무한 루프 방지
}

export interface SimReport {
  tier: number;
  runs: number;
  wins: number;
  winRate: number; // 0~1
  avgRounds: number;
  avgAllyDeaths: number;
  avgFoeSurvivors: number; // 패배 시 남은 적 수 (참패 정도)
  deathsByClass: Record<string, number>;
  skillUses: number; // 전체 특기 사용 횟수
  avgHpLeft: number; // 승리 시 남은 아군 체력 비율 (0~1) — 여유가 얼마나 있었나
}

// ── 아군 AI (간이) — 사람이 둘 법한 무난한 수를 둔다.
// 목적은 '최적 플레이'가 아니라 '일관된 기준'이다. 같은 기준으로 전후를 비교해야
// 밸런스 변화가 보인다.
export function allyAct(s0: BattleState): BattleState {
  const u = currentUnit(s0);
  if (!u || u.side !== 'ally') return s0;

  // 1) 특기가 확실히 이득일 때 쓴다
  if (canUseSkill(s0, u)) {
    const def = skillOf(u);
    if (def) {
      if (def.healMul) {
        // 기도 — 아군 둘 이상이 다쳤을 때만 (혼자 살짝 깎인 정도면 아낀다)
        const hurt = healTargets(s0, u).filter((t) => t.hp < t.maxHp * 0.7).length;
        if (hurt >= 2) return doSkill(s0, null);
      } else if (def.area === 'adjacent') {
        // 회전베기 — 인접한 적이 둘 이상이면
        if (skillTargets(s0, u).length >= 2) return doSkill(s0, null);
      } else {
        // 저격·관통 — 닿는 적이 있으면 가장 약한 쪽에
        const targets = skillTargets(s0, u);
        if (targets.length) {
          const t = targets.slice().sort((a, b) => a.hp - b.hp)[0];
          return doSkill(s0, t.id);
        }
      }
    }
  }

  // 2) 때릴 수 있으면 가장 이득인 표적을 (이동 후 공격 포함)
  const plans = [...reachableAttacks(s0, u).values()];
  if (plans.length) {
    const best = plans
      .map((p) => {
        const t = s0.units.find((x) => x.id === p.targetId)!;
        const kill = p.dmg >= t.hp;
        return { p, score: (kill ? 1000 : 0) + p.dmg * 2 - p.counter * 1.5 - t.hp * 0.1 };
      })
      .sort((a, b) => b.score - a.score)[0];
    return doPlannedAttack(s0, best.p);
  }

  // 3) 못 때리면 가장 가까운 적 쪽으로 접근
  const foes = s0.units.filter((t) => t.alive && t.side === 'foe');
  if (foes.length && !s0.moved) {
    let best: { x: number; y: number; d: number } | null = null;
    for (const tile of movesFor(s0, u).values()) {
      const d = Math.min(...foes.map((f) => dist(tile.x, tile.y, f.x, f.y)));
      if (!best || d < best.d) best = { x: tile.x, y: tile.y, d };
    }
    if (best && (best.x !== u.x || best.y !== u.y)) {
      // 접근만 하고 턴을 넘긴다
      const moved = doMove(s0, best.x, best.y);
      if (moved !== s0) return doWait(moved);
    }
  }
  return doWait(s0);
}

/** 전투 한 판을 끝까지 굴린다 */
export function runBattle(s0: BattleState, maxRounds = 60) {
  let s = s0;
  let skillUses = 0;
  let guard = 0;
  while (!s.result && s.round <= maxRounds && guard++ < 4000) {
    const u = currentUnit(s);
    if (!u) break;
    const before = s;
    const cdBefore = u.cd;
    s = u.side === 'ally' ? allyAct(s) : foeAct(s);
    if (s === before) s = doWait(before); // 아무 일도 못 했으면 강제로 넘긴다 (교착 방지)
    const after = s.units.find((x) => x.id === u.id);
    if (after && after.cd > cdBefore) skillUses++;
  }
  return { state: s, skillUses };
}

/** N판 돌려 리포트를 만든다 */
export function runSim(opts: SimOptions = {}): SimReport {
  const tier = opts.tier ?? 3;
  const runs = opts.runs ?? 100;
  const seed0 = opts.seed ?? 1234;
  const partyCls = opts.party ?? (['sword', 'bow', 'staff'] as ClassId[]);
  const level = opts.level ?? Math.max(1, Math.round(tier * 0.8));
  const maxRounds = opts.maxRounds ?? 60;

  let wins = 0;
  let rounds = 0;
  let allyDeaths = 0;
  let foeSurvivors = 0;
  let skillUses = 0;
  let hpLeft = 0;
  const deathsByClass: Record<string, number> = {};

  for (let i = 0; i < runs; i++) {
    const seed = seed0 + i * 977;
    const party: Unit[] = partyCls.map((cls, j) => makeUnit(`ally-${j}`, cls, level, 0, 0));
    const enc = buildEncounter(seed, tier, party, !!opts.boss);
    const s0 = createBattle(seed, enc.board, enc.allies, enc.foes, { potion: 2 });
    const { state, skillUses: su } = runBattle(s0, maxRounds);

    skillUses += su;
    rounds += state.round;
    const allies = state.units.filter((u) => u.side === 'ally');
    const dead = allies.filter((u) => !u.alive);
    allyDeaths += dead.length;
    for (const d of dead) deathsByClass[d.cls] = (deathsByClass[d.cls] ?? 0) + 1;

    if (state.result === 'win') {
      wins++;
      const ratio =
        allies.reduce((acc, u) => acc + (u.alive ? u.hp / u.maxHp : 0), 0) / allies.length;
      hpLeft += ratio;
    } else {
      foeSurvivors += state.units.filter((u) => u.side === 'foe' && u.alive).length;
    }
  }

  const losses = runs - wins;
  return {
    tier,
    runs,
    wins,
    winRate: wins / runs,
    avgRounds: +(rounds / runs).toFixed(1),
    avgAllyDeaths: +(allyDeaths / runs).toFixed(2),
    avgFoeSurvivors: losses ? +(foeSurvivors / losses).toFixed(2) : 0,
    deathsByClass,
    skillUses,
    avgHpLeft: wins ? +(hpLeft / wins).toFixed(2) : 0,
  };
}

// ── 원정 한 판 통째로 (단계별 승률보다 이쪽이 진짜 난이도다)
// 단계별 sweep은 "아군이 이 레벨이라면"이라는 가정이 들어간다. 실제 게임에서 레벨은
// 앞선 전투에서 번 경험치로 정해지므로, 원정을 통째로 굴려야 곡선을 제대로 볼 수 있다.
export interface CampaignReport {
  runs: number;
  cleared: number; // 8단계까지 완주한 횟수
  clearRate: number;
  avgTierReached: number;
  wipeByTier: Record<number, number>; // 어느 단계에서 전멸했나
  avgLevelAtEnd: number;
}

export function runCampaign(opts: SimOptions & { stages?: number } = {}): CampaignReport {
  const runs = opts.runs ?? 100;
  const seed0 = opts.seed ?? 4321;
  const stages = opts.stages ?? 8;
  const partyCls = opts.party ?? (['sword', 'bow', 'staff'] as ClassId[]);
  const maxRounds = opts.maxRounds ?? 60;

  let cleared = 0;
  let tierSum = 0;
  let levelSum = 0;
  const wipeByTier: Record<number, number> = {};

  for (let i = 0; i < runs; i++) {
    const seed = seed0 + i * 977;
    let party: Unit[] = partyCls.map((cls, j) => makeUnit(`ally-${j}`, cls, 1, 0, 0));
    let reached = 0;

    for (let tier = 1; tier <= stages; tier++) {
      const enc = buildEncounter(seed + tier * 13, tier, party, tier === stages);
      const s0 = createBattle(seed + tier * 31, enc.board, enc.allies, enc.foes, { potion: 2 });
      const { state } = runBattle(s0, maxRounds);

      // 전투 결과를 원정 상태로 반영 (App.tsx와 같은 규칙: 쓰러진 아군은 체력 1로 부활)
      const after = state.units.filter((u) => u.side === 'ally');
      party = party.map((p) => {
        const b = after.find((x) => x.id === p.id);
        if (!b) return p;
        return { ...p, hp: b.alive ? b.hp : 1, level: b.level, exp: b.exp, atk: b.atk, def: b.def, maxHp: b.maxHp, speed: b.speed };
      });

      if (state.result !== 'win') {
        wipeByTier[tier] = (wipeByTier[tier] ?? 0) + 1;
        break;
      }
      reached = tier;

      // 정비 — 야영은 소폭 회복, 3단계마다 마을에서 완전 회복 (지도 생성 규칙의 근사)
      const camp = tier % 3 === 0;
      party = party.map((u) => ({
        ...u,
        hp: camp ? u.maxHp : Math.min(u.maxHp, u.hp + Math.round(u.maxHp * 0.25)),
      }));
    }

    if (reached >= stages) cleared++;
    tierSum += reached;
    levelSum += party.reduce((a, u) => a + u.level, 0) / party.length;
  }

  return {
    runs,
    cleared,
    clearRate: +(cleared / runs).toFixed(3),
    avgTierReached: +(tierSum / runs).toFixed(2),
    wipeByTier,
    avgLevelAtEnd: +(levelSum / runs).toFixed(2),
  };
}

/** 단계 1~8을 훑어 난이도 곡선을 본다 */
export function runSweep(opts: SimOptions = {}): SimReport[] {
  const out: SimReport[] = [];
  for (let tier = 1; tier <= 8; tier++) out.push(runSim({ ...opts, tier }));
  return out;
}

/** 사람이 읽을 표로 */
export function formatSweep(reports: SimReport[]): string {
  const head = '단계  승률   평균라운드  아군사망  승리시남은체력  특기사용';
  const rows = reports.map(
    (r) =>
      `  ${String(r.tier).padStart(2)}  ${(r.winRate * 100).toFixed(0).padStart(3)}%` +
      `   ${String(r.avgRounds).padStart(8)}  ${String(r.avgAllyDeaths).padStart(7)}` +
      `  ${String((r.avgHpLeft * 100).toFixed(0) + '%').padStart(13)}  ${String(r.skillUses).padStart(7)}`,
  );
  return [head, ...rows].join('\n');
}

// ── 브라우저 콘솔 훅 (프로덕션 제외)
export function installSimHook() {
  if (!import.meta.env.DEV) return;
  (window as unknown as Record<string, unknown>).__bqsim = {
    start: (opts: SimOptions = {}) => {
      const r = runSim(opts);
      console.log(`[단계 ${r.tier}] ${r.runs}판 — 승률 ${(r.winRate * 100).toFixed(0)}%`, r);
      return r;
    },
    sweep: (opts: SimOptions = {}) => {
      const rs = runSweep(opts);
      console.log(formatSweep(rs));
      return rs;
    },
    campaign: (opts: SimOptions = {}) => {
      const r = runCampaign(opts);
      console.log(`원정 완주율 ${(r.clearRate * 100).toFixed(0)}% · 평균 도달 ${r.avgTierReached}단계`, r);
      return r;
    },
    runSim,
    runSweep,
    runCampaign,
  };
}
