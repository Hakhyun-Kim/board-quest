// 턴제 전투 엔진 — 이 게임의 심장. 렌더·React와 완전히 분리된 순수 함수 모음이라
// 헤드리스로 수천 판을 돌려 밸런스를 측정할 수 있다 (docs/DESIGN.md의 검증 기둥).
//
// 규칙 요약
//  · 라운드마다 살아 있는 전원이 속도(speed) 순으로 한 번씩 행동한다.
//  · 한 유닛의 턴 = 이동(선택) + 행동 1회(공격/회복/아이템/대기).
//  · 공격 후 상대가 살아 있고 상대의 사거리 안이면 반격(60%)을 맞는다.
//  · 지형이 공격·방어를 보정한다 (언덕 +공격, 숲 +방어).
import {
  TERRAIN,
  dist,
  key,
  reachable,
  terrainAt,
  tilesInRange,
  unitAt,
  type Board,
} from './board';
import { ITEMS, useItem, type Inventory } from './items';
import { nextRand } from './rng';
import { SKILLS, skillRange, type SkillDef } from './skills';
import { CLASSES, gainExp, type Unit } from './units';

export type BattleResult = 'win' | 'lose' | null;

export interface BattleState {
  board: Board;
  units: Unit[];
  order: string[]; // 이번 라운드 행동 순서 (유닛 id)
  turnIdx: number;
  round: number;
  seed: number; // 판정용 난수 상태 (리플레이 가능)
  log: string[];
  result: BattleResult;
  items: Inventory; // 전투 중 소지품 (끝나면 원정 상태로 반영)
  moved: boolean; // 현재 유닛이 이번 턴에 이동했는지
  startPos: { x: number; y: number } | null; // 이동 취소용 원위치
  exp: number; // 이번 전투에서 아군이 얻은 총 경험치 (결과 화면용)
}

const clone = (s: BattleState): BattleState => ({
  ...s,
  units: s.units.map((u) => ({ ...u })),
  order: [...s.order],
  log: [...s.log],
  items: { ...s.items },
  startPos: s.startPos ? { ...s.startPos } : null,
});

const alive = (s: BattleState, side?: Unit['side']) =>
  s.units.filter((u) => u.alive && (side ? u.side === side : true));

export const currentUnit = (s: BattleState): Unit | null => {
  const id = s.order[s.turnIdx];
  return s.units.find((u) => u.id === id && u.alive) ?? null;
};

// 라운드 순서 — 속도 내림차순, 동률이면 아군 먼저(플레이어에게 유리한 관례), 그다음 id
function buildOrder(units: Unit[]): string[] {
  return units
    .filter((u) => u.alive)
    .slice()
    .sort((a, b) => {
      if (b.speed !== a.speed) return b.speed - a.speed;
      if (a.side !== b.side) return a.side === 'ally' ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    })
    .map((u) => u.id);
}

export function createBattle(
  seed: number,
  board: Board,
  allies: Unit[],
  foes: Unit[],
  items: Inventory,
): BattleState {
  const units = [...allies, ...foes].map((u) => ({ ...u, acted: false, buffAtk: 0, cd: 0 }));
  const s: BattleState = {
    board,
    units,
    order: buildOrder(units),
    turnIdx: 0,
    round: 1,
    seed,
    log: ['전투 시작!'],
    result: null,
    items,
    moved: false,
    startPos: null,
    exp: 0,
  };
  return s;
}

// ── 판정용 난수 (상태를 소비하며 굴린다)
function roll(s: BattleState): number {
  const [v, next] = nextRand(s.seed);
  s.seed = next;
  return v;
}

// 지형 보정을 반영한 기본 피해량 (난수 전) — UI 미리보기와 실제 판정이 같은 식을 쓴다
export function baseDamage(board: Board, attacker: Unit, defender: Unit): number {
  const aT = TERRAIN[terrainAt(board, attacker.x, attacker.y)];
  const dT = TERRAIN[terrainAt(board, defender.x, defender.y)];
  const raw = attacker.atk + attacker.buffAtk + aT.atk - (defender.def + dT.def);
  return Math.max(1, raw);
}

// UI용 예상 피해 (±10% 폭을 그대로 보여 준다). mul은 스킬 배수 — 미리보기와 판정이 같은 식.
export function previewDamage(board: Board, attacker: Unit, defender: Unit, mul = 1) {
  const b = baseDamage(board, attacker, defender) * mul;
  return { min: Math.max(1, Math.round(b * 0.9)), max: Math.round(b * 1.1) };
}

// 처치 경험치를 원정대 전체에 나눈다.
// 막타를 친 유닛만 받으면 한 명만 크고 나머지가 뒤처져, 원정 후반의 적 레벨을
// 파티가 통째로 못 따라간다 (시뮬레이터 측정: 완주율 0%). 전열이 몸으로 버는 동안
// 후열도 같이 크는 게 파티 게임의 상식이기도 하다.
export const PARTY_EXP_SHARE = 1.0; // 막타를 못 친 동료가 받는 비율

function awardExp(s: BattleState, killer: Unit, base: number) {
  for (const u of s.units) {
    if (u.side !== 'ally' || !u.alive) continue;
    const exp = u.id === killer.id ? base : Math.round(base * PARTY_EXP_SHARE);
    if (exp <= 0) continue;
    const { unit, levelUps } = gainExp(u, exp);
    Object.assign(u, unit);
    if (levelUps > 0) s.log.push(`${u.name} 레벨 업! (Lv.${u.level})`);
  }
  s.exp += base;
}

function applyDamage(s: BattleState, attacker: Unit, defender: Unit, mul = 1): number {
  const b = baseDamage(s.board, attacker, defender) * mul;
  const dmg = Math.max(1, Math.round(b * (0.9 + roll(s) * 0.2)));
  defender.hp = Math.max(0, defender.hp - dmg);
  if (defender.hp === 0) {
    defender.alive = false;
    s.log.push(`${defender.name} 쓰러짐!`);
    // 아군이 쓰러뜨렸으면 원정대 전체에 경험치
    if (attacker.side === 'ally') awardExp(s, attacker, 50 + defender.level * 12);
  }
  return dmg;
}

// ── 조회 (UI가 하이라이트를 그릴 때 사용)
export const movesFor = (s: BattleState, u: Unit) => reachable(s.board, s.units, u);

export function attackTargets(s: BattleState, u: Unit): Unit[] {
  return s.units.filter(
    (t) => t.alive && t.side !== u.side && dist(u.x, u.y, t.x, t.y) <= u.range,
  );
}

export function healTargets(s: BattleState, u: Unit): Unit[] {
  return s.units.filter(
    (t) => t.alive && t.side === u.side && dist(u.x, u.y, t.x, t.y) <= u.range,
  );
}

export function itemTargets(s: BattleState, u: Unit, itemId: string): Unit[] {
  const def = ITEMS[itemId];
  if (!def) return [];
  return s.units.filter((t) => {
    if (!t.alive) return false;
    const sideOk = def.target === 'ally' ? t.side === u.side : t.side !== u.side;
    return sideOk && dist(u.x, u.y, t.x, t.y) <= def.range;
  });
}

// ── 이동 후 공격 계획
// "이 적을 이번 턴에 때릴 수 있나"를 매번 손으로 확인하지 않아도 되게, 갈 수 있는 칸까지
// 포함해 미리 계산해 둔다. UI 하이라이트도, 시뮬레이터의 아군 AI도 같은 함수를 쓴다.
export interface AttackPlan {
  x: number; // 때릴 자리
  y: number;
  targetId: string;
  dmg: number; // 기본 피해 (난수 전)
  counter: number; // 예상 반격 (0이면 반격 없음)
  moves: boolean; // 이동이 필요한가
}

/** 이 적을 때릴 수 있는 가장 좋은 자리 (없으면 null) */
export function planAttack(
  s: BattleState,
  u: Unit,
  target: Unit,
  tilesIn?: { x: number; y: number }[],
): AttackPlan | null {
  if (!target.alive || target.side === u.side || !u.alive) return null;
  // 이미 이동했으면 제자리에서만 때릴 수 있다
  const tiles =
    tilesIn ?? (s.moved ? [{ x: u.x, y: u.y }] : [...reachable(s.board, s.units, u).values()]);

  let best: (AttackPlan & { score: number }) | null = null;
  for (const t of tiles) {
    const d = dist(t.x, t.y, target.x, target.y);
    if (d > u.range) continue;
    const probe = { ...u, x: t.x, y: t.y };
    const dmg = baseDamage(s.board, probe, target);
    const counter = d <= target.range ? baseDamage(s.board, target, probe) * 0.6 : 0;
    // 다른 적의 사거리에 들어가는 자리는 피한다 (표적 하나 잡자고 뭇매를 맞지 않게)
    const exposure = s.units.filter(
      (o) => o.alive && o.side !== u.side && o.id !== target.id && dist(t.x, t.y, o.x, o.y) <= o.range,
    ).length;
    const stays = t.x === u.x && t.y === u.y;
    // 같은 값이면 제자리를 선호 (쓸데없이 움직이지 않게)
    const score = dmg * 2 - counter * 1.5 - exposure * 3 + (stays ? 0.1 : 0);
    if (!best || score > best.score) {
      best = { x: t.x, y: t.y, targetId: target.id, dmg, counter, moves: !stays, score };
    }
  }
  if (!best) return null;
  const { score: _score, ...plan } = best;
  return plan;
}

/** 이번 턴에 때릴 수 있는 적 전부 — 이동해야 닿는 것까지 포함 (적 id → 계획) */
export function reachableAttacks(s: BattleState, u: Unit): Map<string, AttackPlan> {
  const out = new Map<string, AttackPlan>();
  if (!u.alive) return out;
  const tiles = s.moved ? [{ x: u.x, y: u.y }] : [...reachable(s.board, s.units, u).values()];
  for (const t of s.units) {
    if (!t.alive || t.side === u.side) continue;
    const p = planAttack(s, u, t, tiles);
    if (p) out.set(t.id, p);
  }
  return out;
}

/** 계획대로 (필요하면 이동한 뒤) 공격 — 클릭 한 번에 일어나는 일 */
export function doPlannedAttack(s0: BattleState, plan: AttackPlan): BattleState {
  let s = s0;
  if (plan.moves) {
    s = doMove(s, plan.x, plan.y);
    if (s === s0) return s0; // 이동이 막히면 아무것도 하지 않는다
  }
  return doAttack(s, plan.targetId);
}

// ── 특기(스킬)
/** 이 유닛이 지금 특기를 쓸 수 있는가 (배운 게 있고, 쿨다운이 돌았고, 맞을 대상이 있는가) */
export function canUseSkill(s: BattleState, u: Unit): boolean {
  const def = skillOf(u);
  if (!def || u.cd > 0) return false;
  if (def.healMul) return skillAllies(s, u, def).some((t) => t.hp < t.maxHp);
  if (def.buffAtk) return skillAllies(s, u, def).some((t) => t.id !== u.id); // 몰아칠 부하가 있는가
  return skillTargets(s, u).length > 0;
}

export const skillOf = (u: Unit): SkillDef | null => (u.skill ? SKILLS[u.skill] : null);

/** 회복·버프가 닿는 아군 (같은 편, 살아 있고, 특기의 아군 사거리 안) */
export function skillAllies(s: BattleState, u: Unit, def: SkillDef): Unit[] {
  const r = def.allyRange ?? u.range;
  return s.units.filter((t) => t.alive && t.side === u.side && dist(u.x, u.y, t.x, t.y) <= r);
}

/** 특기로 고를 수 있는 대상들 (self형은 실제로 맞을 적들을 돌려준다 — UI 하이라이트용) */
export function skillTargets(s: BattleState, u: Unit): Unit[] {
  const def = skillOf(u);
  if (!def) return [];
  if (def.area === 'adjacent') {
    return s.units.filter((t) => t.alive && t.side !== u.side && dist(u.x, u.y, t.x, t.y) <= 1);
  }
  const r = skillRange(def, u.range);
  return s.units.filter((t) => t.alive && t.side !== u.side && dist(u.x, u.y, t.x, t.y) <= r);
}

/** 관통 — 대상 너머 한 칸에 선 적 (없으면 null) */
function pierceBehind(s: BattleState, u: Unit, t: Unit): Unit | null {
  const dx = Math.sign(t.x - u.x);
  const dy = Math.sign(t.y - u.y);
  if (dx !== 0 && dy !== 0) return null; // 일직선일 때만 꿰뚫린다
  const n = unitAt(s.units, t.x + dx, t.y + dy);
  return n && n.alive && n.side !== u.side ? n : null;
}

/** 특기가 실제로 때릴 유닛들 — 미리보기와 판정이 같은 목록을 쓴다 */
export function skillVictims(s: BattleState, u: Unit, target: Unit | null): Unit[] {
  const def = skillOf(u);
  if (!def || !def.dmgMul) return [];
  if (def.area === 'adjacent') return skillTargets(s, u);
  if (!target) return [];
  if (def.area === 'pierce') {
    const behind = pierceBehind(s, u, target);
    return behind ? [target, behind] : [target];
  }
  return [target];
}

export function doSkill(s0: BattleState, targetId: string | null): BattleState {
  const s = clone(s0);
  const u = currentUnit(s);
  if (!u) return s0;
  const def = skillOf(u);
  if (!def || u.cd > 0) return s0;

  // 회복형 (사제 기도) — 사거리 안 아군 전체
  if (def.healMul) {
    const base = CLASSES[u.cls].heal ?? 0;
    const amount = Math.round((base + u.level * 3) * def.healMul);
    const targets = skillAllies(s, u, def);
    if (!targets.length || amount <= 0) return s0;
    for (const t of targets) t.hp = Math.min(t.maxHp, t.hp + amount);
    s.log.push(`${def.icon} ${u.name} ${def.name} — 아군 ${targets.length}명 +${amount}`);
    u.cd = def.cooldown;
    return endAction(s);
  }

  // 버프형 (오크 대장 포효) — 사거리 안 '부하'의 공격을 올린다 (자신은 제외 — 부하를 몰아치는 것)
  if (def.buffAtk) {
    const targets = skillAllies(s, u, def).filter((t) => t.id !== u.id);
    if (!targets.length) return s0;
    for (const t of targets) t.buffAtk += def.buffAtk;
    s.log.push(`${def.icon} ${u.name} ${def.name} — 부하 ${targets.length}명 공격 +${def.buffAtk}`);
    u.cd = def.cooldown;
    return endAction(s);
  }

  const target = targetId ? (s.units.find((x) => x.id === targetId) ?? null) : null;
  if (def.target === 'foe') {
    if (!target || !target.alive) return s0;
    if (dist(u.x, u.y, target.x, target.y) > skillRange(def, u.range)) return s0;
  }
  const victims = skillVictims(s, u, target);
  if (!victims.length) return s0;

  const names: string[] = [];
  for (const v of victims) {
    const dmg = applyDamage(s, u, v, def.dmgMul ?? 1);
    names.push(`${v.name} ${dmg}`);
  }
  s.log.push(`${def.icon} ${u.name} ${def.name} — ${names.join(', ')} 피해`);

  // 반격 — 스킬이 허용할 때만, 그리고 첫 대상에게서만
  if (!def.noCounter) {
    const first = victims[0];
    if (first.alive && dist(u.x, u.y, first.x, first.y) <= first.range) {
      const c = applyDamage(s, first, u, 0.6);
      s.log.push(`${first.name} 반격! ${c} 피해`);
    }
  }
  u.cd = def.cooldown;
  return endAction(s);
}

// ── 행동
export function doMove(s0: BattleState, x: number, y: number): BattleState {
  const s = clone(s0);
  const u = currentUnit(s);
  if (!u || s.moved) return s0;
  const reach = reachable(s.board, s.units, u);
  if (!reach.has(key(x, y))) return s0;
  s.startPos = { x: u.x, y: u.y };
  u.x = x;
  u.y = y;
  s.moved = true;
  return s;
}

// 이동 취소 (행동 전이라면 되돌릴 수 있다 — 고전 SRPG의 배려)
export function undoMove(s0: BattleState): BattleState {
  const s = clone(s0);
  const u = currentUnit(s);
  if (!u || !s.moved || !s.startPos) return s0;
  u.x = s.startPos.x;
  u.y = s.startPos.y;
  s.moved = false;
  s.startPos = null;
  return s;
}

export function doAttack(s0: BattleState, targetId: string): BattleState {
  const s = clone(s0);
  const u = currentUnit(s);
  const t = s.units.find((x) => x.id === targetId);
  if (!u || !t || !t.alive || dist(u.x, u.y, t.x, t.y) > u.range) return s0;

  const dmg = applyDamage(s, u, t);
  s.log.push(`${u.name} → ${t.name} 에게 ${dmg} 피해`);

  // 반격 — 살아남았고, 상대의 사거리 안에 있으면 (원거리 저격은 반격받지 않는다)
  if (t.alive && dist(u.x, u.y, t.x, t.y) <= t.range) {
    const c = applyDamage(s, t, u, 0.6);
    s.log.push(`${t.name} 반격! ${c} 피해`);
  }
  return endAction(s);
}

export function doHeal(s0: BattleState, targetId: string): BattleState {
  const s = clone(s0);
  const u = currentUnit(s);
  const t = s.units.find((x) => x.id === targetId);
  const heal = u ? (u.cls === 'staff' ? 14 + u.level * 3 : 0) : 0;
  if (!u || !t || !t.alive || heal <= 0 || dist(u.x, u.y, t.x, t.y) > u.range) return s0;
  const before = t.hp;
  t.hp = Math.min(t.maxHp, t.hp + heal);
  s.log.push(`${u.name} → ${t.name} 회복 +${t.hp - before}`);
  return endAction(s);
}

export function doItem(s0: BattleState, itemId: string, targetId: string): BattleState {
  const s = clone(s0);
  const u = currentUnit(s);
  const t = s.units.find((x) => x.id === targetId);
  const def = ITEMS[itemId];
  if (!u || !t || !def || !t.alive || (s.items[itemId] ?? 0) <= 0) return s0;
  if (dist(u.x, u.y, t.x, t.y) > def.range) return s0;

  if (def.heal) {
    const before = t.hp;
    t.hp = Math.min(t.maxHp, t.hp + def.heal);
    s.log.push(`${def.icon} ${def.name} — ${t.name} 회복 +${t.hp - before}`);
  }
  if (def.buffAtk) {
    t.buffAtk += def.buffAtk;
    s.log.push(`${def.icon} ${def.name} — ${t.name} 공격력 +${def.buffAtk}`);
  }
  if (def.damage) {
    const hit = (target: Unit) => {
      target.hp = Math.max(0, target.hp - def.damage!);
      if (target.hp === 0) {
        target.alive = false;
        s.log.push(`${target.name} 쓰러짐!`);
      }
    };
    hit(t);
    if (def.splash) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const n = unitAt(s.units, t.x + dx, t.y + dy);
        if (n && n.side !== u.side) hit(n);
      }
    }
    s.log.push(`${def.icon} ${def.name} — ${t.name} 에게 ${def.damage} 피해`);
  }
  s.items = useItem(s.items, itemId);
  return endAction(s);
}

export function doWait(s0: BattleState): BattleState {
  const s = clone(s0);
  const u = currentUnit(s);
  if (!u) return s0;
  s.log.push(`${u.name} 대기`);
  return endAction(s);
}

// 행동 종료 → 승패 판정 → 다음 유닛
function endAction(s: BattleState): BattleState {
  const u = currentUnit(s);
  if (u) u.acted = true;
  s.moved = false;
  s.startPos = null;
  return advanceTurn(checkResult(s));
}

export function checkResult(s: BattleState): BattleState {
  if (s.result) return s;
  if (alive(s, 'foe').length === 0) {
    s.result = 'win';
    s.log.push('승리!');
  } else if (alive(s, 'ally').length === 0) {
    s.result = 'lose';
    s.log.push('패배…');
  }
  return s;
}

// 다음 행동 유닛으로 (라운드가 끝나면 순서를 다시 짠다)
export function advanceTurn(s0: BattleState): BattleState {
  const s = clone(s0);
  if (s.result) return s;
  for (let guard = 0; guard < 200; guard++) {
    s.turnIdx += 1;
    if (s.turnIdx >= s.order.length) {
      // 새 라운드
      s.round += 1;
      s.units.forEach((u) => (u.acted = false));
      s.order = buildOrder(s.units);
      s.turnIdx = 0;
    }
    const u = currentUnit(s);
    if (u && !u.acted) {
      // 쿨다운은 '그 유닛의 차례가 돌아올 때' 줄인다.
      // 라운드 넘어갈 때 한꺼번에 줄이면, 라운드 끝에 쓴 느린 유닛이 곧바로 1을 돌려받아
      // 같은 쿨다운 3이라도 속도에 따라 실제 대기가 달라진다.
      if (u.cd > 0) u.cd -= 1;
      return s;
    }
    if (!s.order.length) return s;
  }
  return s;
}

// 적이 이번 턴에 할 수 있는 한 수 (이동 자리 + 무엇을 할지 + 점수).
// 기본 공격과 특기를 같은 점수판에서 비교해, 더 이득인 쪽을 고른다.
interface FoePlan {
  x: number;
  y: number;
  kind: 'attack' | 'skill';
  targetId: string | null;
  score: number;
}

// 어느 자리에서 특기를 쓰는 게 가장 좋은가 (없으면 null)
function bestFoeSkill(s: BattleState, u: Unit, tiles: { x: number; y: number }[]): FoePlan | null {
  const def = skillOf(u);
  if (!def || u.cd > 0) return null;
  const enemies = s.units.filter((t) => t.alive && t.side === 'ally');
  let best: FoePlan | null = null;
  const keep = (p: FoePlan) => {
    if (!best || p.score > best.score) best = p;
  };

  for (const tile of tiles) {
    const probe = { ...u, x: tile.x, y: tile.y };

    // 버프 (포효) — 사거리 안에 몰아칠 부하가 있을 때만
    if (def.buffAtk) {
      const minions = skillAllies(s, probe, def).filter((t) => t.id !== u.id);
      if (minions.length) keep({ ...tile, kind: 'skill', targetId: null, score: minions.length * def.buffAtk * 1.5 });
      continue;
    }
    // 회복 — 다친 아군을 살리는 값어치
    if (def.healMul) {
      const hurt = skillAllies(s, probe, def).filter((t) => t.hp < t.maxHp);
      if (hurt.length) keep({ ...tile, kind: 'skill', targetId: null, score: hurt.length * 8 });
      continue;
    }
    // 피해형 (강타·저격·회전베기·관통)
    const r = skillRange(def, u.range);
    for (const t of enemies) {
      if (def.area !== 'adjacent' && dist(tile.x, tile.y, t.x, t.y) > r) continue;
      const victims = skillVictims(s, probe, def.area === 'adjacent' ? null : t);
      if (!victims.length) continue;
      let dmg = 0;
      let kills = 0;
      for (const v of victims) {
        const d = baseDamage(s.board, probe, v) * (def.dmgMul ?? 1);
        dmg += d;
        if (d >= v.hp) kills++;
      }
      const first = victims[0];
      const counter =
        !def.noCounter && dist(tile.x, tile.y, first.x, first.y) <= first.range
          ? baseDamage(s.board, first, probe) * 0.6
          : 0;
      keep({ ...tile, kind: 'skill', targetId: t.id, score: kills * 1000 + dmg * 2 - counter + (victims.length - 1) * 4 });
    }
  }
  return best;
}

// ── 적 AI: 기본 공격·특기 중 이득이 큰 쪽을 골라 (필요하면 이동 후) 쓴다.
// 없으면 가장 가까운 아군에게 접근. 표적 우선순위: 처치 가능 > 피해량 큼 > 체력 낮음.
export function foeAct(s0: BattleState): BattleState {
  const s = clone(s0);
  const u = currentUnit(s);
  if (!u || u.side !== 'foe') return s0;

  const reach = reachable(s.board, s.units, u);
  const enemies = s.units.filter((t) => t.alive && t.side === 'ally');
  if (!enemies.length) return endAction(s);
  const tiles = [...reach.values()];

  // 기본 공격 중 최선
  let best: FoePlan | null = null;
  for (const tile of tiles) {
    for (const t of enemies) {
      if (dist(tile.x, tile.y, t.x, t.y) > u.range) continue;
      const probe = { ...u, x: tile.x, y: tile.y };
      const dmg = baseDamage(s.board, probe, t);
      const kill = dmg >= t.hp;
      const counter = dist(tile.x, tile.y, t.x, t.y) <= t.range ? baseDamage(s.board, t, probe) * 0.6 : 0;
      const score = (kill ? 1000 : 0) + dmg * 2 - counter - t.hp * 0.1;
      if (!best || score > best.score) best = { x: tile.x, y: tile.y, kind: 'attack', targetId: t.id, score };
    }
  }

  // 특기가 더 이득이면 그쪽으로
  const skill = bestFoeSkill(s, u, tiles);
  if (skill && (!best || skill.score > best.score)) best = skill;

  if (best) {
    if (best.x !== u.x || best.y !== u.y) {
      u.x = best.x;
      u.y = best.y;
      s.moved = true;
    }
    return best.kind === 'skill' ? doSkill(s, best.targetId) : doAttack(s, best.targetId!);
  }

  // 아무것도 못 하면 가장 가까운 아군 쪽으로 최대한 접근
  let move: { x: number; y: number; d: number } | null = null;
  for (const tile of tiles) {
    const d = Math.min(...enemies.map((t) => dist(tile.x, tile.y, t.x, t.y)));
    if (!move || d < move.d) move = { x: tile.x, y: tile.y, d };
  }
  if (move && (move.x !== u.x || move.y !== u.y)) {
    u.x = move.x;
    u.y = move.y;
    s.log.push(`${u.name} 접근`);
  }
  return endAction(s);
}

// 공격 가능한 칸 표시용 (UI) — 현재 위치 기준 사거리 칸
export const rangeTiles = (s: BattleState, u: Unit) => tilesInRange(s.board, u.x, u.y, u.range);
