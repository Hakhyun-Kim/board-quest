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
  doWait,
  foeAct,
  sideItems,
  type BattleState,
} from '../lib/battle';
import { allyAct } from '../lib/autoPlay';
import { HEAL_COST, RECRUIT_COST, START_GOLD } from '../lib/economy';
import { generateJourney, nextNodes, nodeById, travelTo, type Journey, type NodeKind } from '../lib/journey';
import { mulberry32 } from '../lib/rng';
import { battleGold, buildEncounter } from '../lib/encounter';
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

// 아군 AI는 lib/autoPlay.ts로 옮겼다 — 대전의 '봇 담당'과 시뮬레이터가 같은 수를 두게 하려고.
export { allyAct };

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
  // 기본 아군 레벨은 '실제로 그 단계에 도달했을 때의 레벨'에 맞춘다 (원정 시뮬로 실측한 값).
  // 여기가 실제와 어긋나면 단계별 승률이 통째로 거짓말이 된다.
  const level = opts.level ?? Math.max(1, Math.round(1 + tier * 0.45));
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
    const s0 = createBattle(seed, enc.board, enc.allies, enc.foes, sideItems({ potion: 2 }));
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
  avgPartySize: number; // 끝났을 때 인원 (영입이 실제로 됐는지)
  battles: number; // 총 전투 수
  battleWinRate: number; // 전투 단위 승률 — 완주율은 이 값의 거듭제곱에 가깝다
  avgBattlesPerRun: number;
  // 영입 진단 — 왜 3명에 머무는가
  townVisitRate: number; // 마을을 한 번이라도 지난 원정 비율
  recruitRate: number; // 4번째 동료를 얻은 원정 비율
  clearIfRecruited: number; // 영입한 원정의 완주율
  clearIfNot: number; // 영입 못 한 원정의 완주율
}

// 노드에서 특정 종류(예: 마을)까지의 최단 거리 (앞으로 이어진 길로만, 없으면 -1)
function distToKind(journey: Journey, fromId: number, kind: NodeKind): number {
  const seen = new Set<number>([fromId]);
  let frontier = [fromId];
  let d = 0;
  while (frontier.length) {
    for (const id of frontier) if (nodeById(journey, id).kind === kind) return d;
    const next: number[] = [];
    for (const id of frontier)
      for (const n of nodeById(journey, id).next)
        if (!seen.has(n)) { seen.add(n); next.push(n); }
    frontier = next;
    d++;
  }
  return -1;
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
  let sizeSum = 0;
  let battles = 0;
  let battleWins = 0;
  let townRuns = 0;
  let recruitRuns = 0;
  let clearRecruited = 0;
  let clearNot = 0;
  const wipeByTier: Record<number, number> = {};

  for (let i = 0; i < runs; i++) {
    const seed = seed0 + i * 977;
    let party: Unit[] = partyCls.map((cls, j) => makeUnit(`ally-${j}`, cls, 1, 0, 0));
    let gold = START_GOLD;
    let reached = 0;
    let clearedRun = false;
    let wiped = false;
    let sawTown = false;

    // 실제 지도를 생성해 한 갈래를 걸어간다 — 전투·마을·보물·야영이 섞인
    // 진짜 원정이라야 난이도가 제대로 잰다 (전부 전투로 치면 실제보다 훨씬 가혹하다).
    let journey = generateJourney(seed, stages);
    const rand = mulberry32(seed * 7919 + 13);

    for (let step = 0; step < stages + 2; step++) {
      const options = nextNodes(journey);
      if (!options.length) break;
      // 길 고르기 — 사람은 지도 전체를 보고 목적지를 향해 route한다. 시뮬도 그래야 공정하다:
      // 4번째 동료가 없으면 '가장 가까운 마을'로 향하는 갈래를 고른다 (한 걸음 앞만 보지 않게).
      const hurt = party.some((u) => u.hp < u.maxHp * 0.6);
      const wantRecruit = party.length < 4;
      const immediate = (k: NodeKind) =>
        k === 'boss' ? 0 : hurt ? (k === 'town' ? 4 : k === 'camp' ? 2 : k === 'treasure' ? 1 : 0)
          : k === 'battle' ? 2 : k === 'treasure' ? 1 : 0;
      let chosen = options.slice().sort((a, b) => immediate(b.kind) - immediate(a.kind))[0];
      // 영입이 급하면 마을로 가는 최단 갈래를 우선 (한 걸음 앞이 마을이 아니어도)
      if (wantRecruit) {
        const toTown = options
          .map((o) => ({ o, d: distToKind(journey, o.id, 'town') }))
          .filter((x) => x.d >= 0)
          .sort((a, b) => a.d - b.d)[0];
        if (toTown) chosen = toTown.o;
      }
      journey = travelTo(journey, chosen.id);
      const tier = chosen.col;
      reached = tier;

      // 전투가 아닌 노드는 보상만 받고 넘어간다 (App.tsx의 resolveNode와 같은 규칙)
      if (chosen.kind === 'treasure') {
        gold += 30 + Math.floor(rand() * 25) + tier * 8;
        continue;
      }
      if (chosen.kind === 'camp') {
        const heal = 18 + tier * 3;
        party = party.map((u) => ({ ...u, hp: Math.min(u.maxHp, u.hp + heal) }));
        continue;
      }
      if (chosen.kind === 'town') {
        sawTown = true;
        if (party.length < 4 && gold >= RECRUIT_COST) {
          gold -= RECRUIT_COST;
          const lv = Math.max(1, Math.round(party.reduce((a, u) => a + u.level, 0) / party.length));
          party = [...party, makeUnit(`ally-${party.length}`, 'spear', lv, 0, 0)];
        }
        if (gold >= HEAL_COST && party.some((u) => u.hp < u.maxHp)) {
          gold -= HEAL_COST;
          party = party.map((u) => ({ ...u, hp: u.maxHp }));
        }
        continue;
      }

      const isBoss = chosen.kind === 'boss';
      const enc = buildEncounter(seed + tier * 13, tier, party, isBoss);
      const s0 = createBattle(seed + tier * 31, enc.board, enc.allies, enc.foes, sideItems({ potion: 2 }));
      const { state } = runBattle(s0, maxRounds);
      battles++;
      if (state.result === 'win') battleWins++;

      // 전투 결과를 원정 상태로 반영 (App.tsx와 같은 규칙: 쓰러진 아군은 체력 1로 부활)
      const after = state.units.filter((u) => u.side === 'ally');
      party = party.map((p) => {
        const b = after.find((x) => x.id === p.id);
        if (!b) return p;
        return { ...p, hp: b.alive ? b.hp : 1, level: b.level, exp: b.exp, atk: b.atk, def: b.def, maxHp: b.maxHp, speed: b.speed };
      });

      if (state.result !== 'win') {
        wipeByTier[tier] = (wipeByTier[tier] ?? 0) + 1;
        wiped = true;
        break;
      }
      gold += battleGold(tier, isBoss);
      if (isBoss) {
        clearedRun = true;
        break;
      }
    }

    if (clearedRun) cleared++;
    void wiped;
    tierSum += reached;
    levelSum += party.reduce((a, u) => a + u.level, 0) / party.length;
    sizeSum += party.length;
    if (sawTown) townRuns++;
    const recruited = party.length >= 4;
    if (recruited) {
      recruitRuns++;
      if (clearedRun) clearRecruited++;
    } else if (clearedRun) clearNot++;
  }

  return {
    runs,
    cleared,
    clearRate: +(cleared / runs).toFixed(3),
    avgTierReached: +(tierSum / runs).toFixed(2),
    wipeByTier,
    avgLevelAtEnd: +(levelSum / runs).toFixed(2),
    avgPartySize: +(sizeSum / runs).toFixed(2),
    battles,
    battleWinRate: battles ? +(battleWins / battles).toFixed(3) : 0,
    avgBattlesPerRun: +(battles / runs).toFixed(2),
    townVisitRate: +(townRuns / runs).toFixed(3),
    recruitRate: +(recruitRuns / runs).toFixed(3),
    clearIfRecruited: recruitRuns ? +(clearRecruited / recruitRuns).toFixed(3) : 0,
    clearIfNot: runs - recruitRuns ? +(clearNot / (runs - recruitRuns)).toFixed(3) : 0,
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
