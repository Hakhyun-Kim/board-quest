// 전투 보드 — 절차 생성 지형 + 이동 범위/경로 계산.
// 렌더와 완전히 분리된 순수 로직이라 헤드리스로 검증할 수 있다.
import { mulberry32 } from './rng';
import type { Unit } from './units';

export type Terrain = 'plain' | 'forest' | 'hill' | 'water' | 'rock';

export interface TerrainDef {
  cost: number; // 이동 비용 (Infinity = 통과 불가)
  def: number; // 방어 보정 (받는 피해 감소량)
  atk: number; // 공격 보정 (주는 피해 증가량)
  name: string;
  color: string;
  height: number; // 렌더 높이
}

export const TERRAIN: Record<Terrain, TerrainDef> = {
  plain: { cost: 1, def: 0, atk: 0, name: '평지', color: '#4a6b46', height: 0 },
  forest: { cost: 2, def: 2, atk: 0, name: '숲', color: '#2f5236', height: 0.25 },
  hill: { cost: 2, def: 1, atk: 2, name: '언덕', color: '#7a6a45', height: 0.5 },
  water: { cost: Infinity, def: 0, atk: 0, name: '물', color: '#2c4f7a', height: -0.15 },
  rock: { cost: Infinity, def: 0, atk: 0, name: '바위', color: '#4a4a55', height: 0.9 },
};

export interface Board {
  w: number;
  h: number;
  tiles: Terrain[]; // 길이 w*h, 인덱스 = y*w + x
}

export const idx = (b: Board, x: number, y: number) => y * b.w + x;
export const inBoard = (b: Board, x: number, y: number) =>
  x >= 0 && y >= 0 && x < b.w && y < b.h;
export const terrainAt = (b: Board, x: number, y: number): Terrain =>
  inBoard(b, x, y) ? b.tiles[idx(b, x, y)] : 'rock';
export const passable = (b: Board, x: number, y: number) =>
  TERRAIN[terrainAt(b, x, y)].cost !== Infinity;

export const key = (x: number, y: number) => `${x},${y}`;
export const dist = (ax: number, ay: number, bx: number, by: number) =>
  Math.abs(ax - bx) + Math.abs(ay - by); // 맨해튼 (상하좌우 판)

// ── 절차 생성: 덩어리진 지형 (씨앗을 뿌리고 번지게 해서 자연스러운 숲/언덕/호수)
// 양쪽 진영의 배치 구역(좌우 3열)은 평지로 정리해 시작부터 갇히지 않게 한다.
export function generateBoard(seed: number, w = 16, h = 12): Board {
  const rand = mulberry32(seed * 2654435761 + 17);
  const tiles: Terrain[] = new Array(w * h).fill('plain');
  const board: Board = { w, h, tiles };

  const blobs: [Terrain, number, number][] = [
    ['forest', 3 + Math.floor(rand() * 3), 7],
    ['hill', 2 + Math.floor(rand() * 3), 5],
    ['water', 1 + Math.floor(rand() * 2), 6],
    ['rock', 2 + Math.floor(rand() * 3), 3],
  ];

  for (const [kind, count, size] of blobs) {
    for (let i = 0; i < count; i++) {
      let cx = Math.floor(rand() * w);
      let cy = Math.floor(rand() * h);
      for (let s = 0; s < size; s++) {
        if (inBoard(board, cx, cy)) tiles[idx(board, cx, cy)] = kind;
        // 랜덤 워크로 번지게
        const dir = Math.floor(rand() * 4);
        cx += dir === 0 ? 1 : dir === 1 ? -1 : 0;
        cy += dir === 2 ? 1 : dir === 3 ? -1 : 0;
        cx = Math.max(0, Math.min(w - 1, cx));
        cy = Math.max(0, Math.min(h - 1, cy));
      }
    }
  }

  // 배치 구역 정리 — 왼쪽 3열(아군)·오른쪽 3열(적)은 통과 가능하게
  for (let y = 0; y < h; y++) {
    for (const x of [0, 1, 2, w - 3, w - 2, w - 1]) {
      if (!passable(board, x, y)) tiles[idx(board, x, y)] = 'plain';
    }
  }
  return board;
}

// 유닛이 서 있는 칸 조회 (살아 있는 유닛만)
export function unitAt(units: Unit[], x: number, y: number): Unit | undefined {
  return units.find((u) => u.alive && u.x === x && u.y === y);
}

export interface ReachTile {
  x: number;
  y: number;
  cost: number;
  from: string | null; // 이전 칸 key (경로 역추적)
}

// ── 이동 가능 범위 (다익스트라, 지형 비용 누적)
// 적 유닛은 통과 불가, 아군은 통과 가능하지만 그 칸에 멈출 수는 없다 (고전 SRPG 규칙).
export function reachable(board: Board, units: Unit[], unit: Unit): Map<string, ReachTile> {
  const best = new Map<string, ReachTile>();
  const start: ReachTile = { x: unit.x, y: unit.y, cost: 0, from: null };
  best.set(key(unit.x, unit.y), start);
  // 칸 수가 적어 단순 우선순위 큐(정렬)로 충분하다
  const queue: ReachTile[] = [start];

  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const cur = queue.shift()!;
    const curKey = key(cur.x, cur.y);
    if ((best.get(curKey)?.cost ?? Infinity) < cur.cost) continue;

    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (!inBoard(board, nx, ny)) continue;
      const t = TERRAIN[terrainAt(board, nx, ny)];
      if (t.cost === Infinity) continue;
      const occupant = unitAt(units, nx, ny);
      if (occupant && occupant.side !== unit.side) continue; // 적은 통과 불가
      const cost = cur.cost + t.cost;
      if (cost > unit.move) continue;
      const nKey = key(nx, ny);
      if ((best.get(nKey)?.cost ?? Infinity) <= cost) continue;
      const tile: ReachTile = { x: nx, y: ny, cost, from: curKey };
      best.set(nKey, tile);
      queue.push(tile);
    }
  }

  // 멈출 수 없는 칸(아군이 서 있는 칸) 제거 — 단, 제자리는 남긴다
  for (const [k, tile] of [...best]) {
    if (k === key(unit.x, unit.y)) continue;
    if (unitAt(units, tile.x, tile.y)) best.delete(k);
  }
  return best;
}

// 이동 경로 (렌더 애니메이션용) — reachable 결과에서 역추적
export function pathTo(
  reach: Map<string, ReachTile>,
  x: number,
  y: number,
): [number, number][] {
  const path: [number, number][] = [];
  let cur = reach.get(key(x, y));
  while (cur) {
    path.push([cur.x, cur.y]);
    cur = cur.from ? reach.get(cur.from) : undefined;
  }
  return path.reverse();
}

// 특정 위치에서 사거리 안에 드는 칸들
export function tilesInRange(board: Board, x: number, y: number, range: number) {
  const out: [number, number][] = [];
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      const d = Math.abs(dx) + Math.abs(dy);
      if (d === 0 || d > range) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (inBoard(board, nx, ny)) out.push([nx, ny]);
    }
  }
  return out;
}
