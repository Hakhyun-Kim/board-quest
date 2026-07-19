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
import { gainExp, type Unit } from './units';

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
  const units = [...allies, ...foes].map((u) => ({ ...u, acted: false, buffAtk: 0 }));
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

// UI용 예상 피해 (±10% 폭을 그대로 보여 준다)
export function previewDamage(board: Board, attacker: Unit, defender: Unit) {
  const b = baseDamage(board, attacker, defender);
  return { min: Math.max(1, Math.round(b * 0.9)), max: Math.round(b * 1.1) };
}

function applyDamage(s: BattleState, attacker: Unit, defender: Unit, mul = 1): number {
  const b = baseDamage(s.board, attacker, defender) * mul;
  const dmg = Math.max(1, Math.round(b * (0.9 + roll(s) * 0.2)));
  defender.hp = Math.max(0, defender.hp - dmg);
  if (defender.hp === 0) {
    defender.alive = false;
    s.log.push(`${defender.name} 쓰러짐!`);
    // 아군이 쓰러뜨렸으면 경험치
    if (attacker.side === 'ally') {
      const exp = 30 + defender.level * 5;
      const { unit, levelUps } = gainExp(attacker, exp);
      Object.assign(attacker, unit);
      s.exp += exp;
      if (levelUps > 0) s.log.push(`${attacker.name} 레벨 업! (Lv.${attacker.level})`);
    }
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
    if (u && !u.acted) return s;
    if (!s.order.length) return s;
  }
  return s;
}

// ── 적 AI: 이번 턴에 때릴 수 있으면 가장 좋은 표적을 때리고, 없으면 가장 가까운 아군에게 접근.
// 표적 우선순위: 처치 가능 > 피해량 큼 > 체력 낮음 (후열 정리를 선호)
export function foeAct(s0: BattleState): BattleState {
  const s = clone(s0);
  const u = currentUnit(s);
  if (!u || u.side !== 'foe') return s0;

  const reach = reachable(s.board, s.units, u);
  const enemies = s.units.filter((t) => t.alive && t.side === 'ally');
  if (!enemies.length) return endAction(s);

  interface Plan {
    x: number;
    y: number;
    target: Unit | null;
    score: number;
  }
  let best: Plan | null = null;

  for (const tile of reach.values()) {
    for (const t of enemies) {
      if (dist(tile.x, tile.y, t.x, t.y) > u.range) continue;
      const probe = { ...u, x: tile.x, y: tile.y };
      const dmg = baseDamage(s.board, probe, t);
      const kill = dmg >= t.hp;
      // 반격을 맞을 위치인지도 살짝 고려 (원거리 유닛이 굳이 붙지 않게)
      const counter = dist(tile.x, tile.y, t.x, t.y) <= t.range ? baseDamage(s.board, t, probe) * 0.6 : 0;
      const score = (kill ? 1000 : 0) + dmg * 2 - counter - t.hp * 0.1;
      if (!best || score > best.score) best = { x: tile.x, y: tile.y, target: t, score };
    }
  }

  if (best && best.target) {
    if (best.x !== u.x || best.y !== u.y) {
      u.x = best.x;
      u.y = best.y;
      s.moved = true;
    }
    return doAttack(s, best.target.id);
  }

  // 때릴 수 없으면 가장 가까운 아군 쪽으로 최대한 접근
  let move: { x: number; y: number; d: number } | null = null;
  for (const tile of reach.values()) {
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
