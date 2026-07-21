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
  // 적 레벨은 '단계'로 오르는데 아군 레벨은 '치른 전투 수'로 오른다. 실제 지도는 8단계에
  // 전투가 4~5번뿐이라, 0.7로 올리면 아군이 구조적으로 따라잡을 수 없다 (시뮬레이터 측정).
  const level = 1 + Math.floor(tier * 0.5);
  if (isBoss) {
    const spot = freeTile(board, placed, rand, board.w - 2, board.w - 1);
    // 대장은 기본 스탯부터 오크보다 훨씬 높다(64/15/7). 여기에 레벨 +1과 호위 3까지 붙으면
    // 같은 단계의 일반 전투가 90%일 때 보스가 5%로 떨어진다 — 벽이 아니라 절벽이었다.
    const boss = makeUnit('foe-boss', 'warlord', level, spot.x, spot.y);
    placed.push(boss);
    foes.push(boss);
    const escorts = 2;
    for (let i = 0; i < escorts; i++) {
      const cls: ClassId = i % 2 === 0 ? 'orc' : 'archer';
      const s = freeTile(board, placed, rand, board.w - 3, board.w - 1);
      const u = makeUnit(`foe-${i}`, cls, level, s.x, s.y);
      placed.push(u);
      foes.push(u);
    }
  } else {
    const pool = foePool(tier);
    // 아군은 3~4명인데 적이 6이면 수적 열세가 너무 커진다 (측정: 같은 레벨에서도 8단계 승률 15%).
    const count = Math.min(5, 2 + Math.floor(tier * 0.45) + (rand() < 0.35 ? 1 : 0));
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

// 대전(PvP) 판 — 두 원정대가 마주 선다.
// 엔진은 진영을 ally/foe 두 쪽으로만 보므로, 오른쪽 진영(2P)은 side를 foe로 바꿔 앉힌다.
// 조작하는 사람이 누구인지는 엔진이 알 필요가 없다 (App이 담당자를 따로 들고 있다).
export function buildVersusEncounter(seed: number, left: Unit[], right: Unit[]): Encounter {
  const rand = mulberry32(seed * 69069 + 977);
  const board = generateBoard(seed + 7);
  const placed: Unit[] = [];

  const seat = (party: Unit[], side: 'ally' | 'foe', x0: number, x1: number) =>
    party.map((u) => {
      const spot = freeTile(board, placed, rand, x0, x1);
      const unit: Unit = { ...u, side, x: spot.x, y: spot.y, acted: false, buffAtk: 0, cd: 0 };
      placed.push(unit);
      return unit;
    });

  const allies = seat(left, 'ally', 0, 1);
  const foes = seat(right, 'foe', board.w - 2, board.w - 1);
  return { board, allies, foes };
}

// 전투 보상 — 단계에 비례한 금화 (경험치는 전투 중 처치로 즉시 지급)
export const battleGold = (tier: number, isBoss: boolean) =>
  Math.round((25 + tier * 12) * (isBoss ? 3 : 1));
