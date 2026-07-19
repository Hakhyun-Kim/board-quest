// 전투 준비 — 원정 단계(tier)에 맞춰 보드·적 편성·배치를 절차 생성한다.
// 난이도 곡선의 단일 출처: 여기 숫자만 바꾸면 전체 밸런스가 움직인다.
import { generateBoard, passable, unitAt, type Board } from './board';
import { mulberry32 } from './rng';
import { makeUnit, type ClassId, type Unit } from './units';

export interface Encounter {
  board: Board;
  allies: Unit[];
  foes: Unit[];
}

// 단계별 등장 적 — 깊어질수록 위험한 종류가 섞인다
function foePool(tier: number): ClassId[] {
  const pool: ClassId[] = ['goblin', 'goblin', 'wolf'];
  if (tier >= 2) pool.push('archer');
  if (tier >= 3) pool.push('orc', 'wolf');
  if (tier >= 5) pool.push('orc', 'archer');
  return pool;
}

// 빈 칸 찾기 (지정 열 범위 안에서 통과 가능하고 비어 있는 칸)
function freeTile(
  board: Board,
  units: Unit[],
  rand: () => number,
  x0: number,
  x1: number,
): { x: number; y: number } {
  for (let tries = 0; tries < 200; tries++) {
    const x = x0 + Math.floor(rand() * (x1 - x0 + 1));
    const y = Math.floor(rand() * board.h);
    if (!passable(board, x, y)) continue;
    if (unitAt(units, x, y)) continue;
    return { x, y };
  }
  // 최후 수단 — 전수 조사
  for (let y = 0; y < board.h; y++)
    for (let x = x0; x <= x1; x++)
      if (passable(board, x, y) && !unitAt(units, x, y)) return { x, y };
  return { x: x0, y: 0 };
}

// 전투 하나를 구성한다. party는 원정대의 현재 유닛(체력·레벨 유지).
export function buildEncounter(
  seed: number,
  tier: number,
  party: Unit[],
  isBoss: boolean,
): Encounter {
  const rand = mulberry32(seed * 69069 + tier * 131 + 11);
  const board = generateBoard(seed + tier * 7);
  const placed: Unit[] = [];

  // 아군 — 왼쪽 두 열에 배치 (체력·레벨은 원정 상태 그대로)
  const allies = party.map((u) => {
    const spot = freeTile(board, placed, rand, 0, 1);
    const unit = { ...u, x: spot.x, y: spot.y, acted: false, buffAtk: 0 };
    placed.push(unit);
    return unit;
  });

  // 적 — 오른쪽 세 열. 수와 레벨이 단계에 비례한다.
  const foes: Unit[] = [];
  const level = 1 + Math.floor(tier * 0.7);
  if (isBoss) {
    const spot = freeTile(board, placed, rand, board.w - 2, board.w - 1);
    const boss = makeUnit('foe-boss', 'warlord', level + 1, spot.x, spot.y);
    placed.push(boss);
    foes.push(boss);
    const escorts = 3;
    for (let i = 0; i < escorts; i++) {
      const cls: ClassId = i % 2 === 0 ? 'orc' : 'archer';
      const s = freeTile(board, placed, rand, board.w - 3, board.w - 1);
      const u = makeUnit(`foe-${i}`, cls, level, s.x, s.y);
      placed.push(u);
      foes.push(u);
    }
  } else {
    const pool = foePool(tier);
    const count = Math.min(6, 2 + Math.floor(tier * 0.6) + (rand() < 0.4 ? 1 : 0));
    for (let i = 0; i < count; i++) {
      const cls = pool[Math.floor(rand() * pool.length)];
      const s = freeTile(board, placed, rand, board.w - 3, board.w - 1);
      const u = makeUnit(`foe-${i}`, cls, level, s.x, s.y);
      placed.push(u);
      foes.push(u);
    }
  }

  return { board, allies, foes };
}

// 전투 보상 — 단계에 비례한 금화 (경험치는 전투 중 처치로 즉시 지급)
export const battleGold = (tier: number, isBoss: boolean) =>
  Math.round((25 + tier * 12) * (isBoss ? 3 : 1));
