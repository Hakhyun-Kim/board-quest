// 원정 지도 — 히어로즈/보드게임처럼 '길을 골라' 나아가는 노드 그래프.
// 절차 생성이며 시드가 같으면 같은 지도가 나온다. 층=시드 대신 '원정 번호 = 시드'.
import { mulberry32, pick } from './rng';

export type NodeKind = 'start' | 'battle' | 'town' | 'treasure' | 'camp' | 'boss';

export interface JourneyNode {
  id: number;
  col: number; // 진행 단계 (0 = 출발, 마지막 = 보스)
  row: number; // 같은 단계 안에서의 위치 (0이 위)
  rows: number; // 그 단계의 노드 수 (화면 배치용)
  kind: NodeKind;
  next: number[]; // 갈 수 있는 다음 노드
  visited: boolean;
}

export interface Journey {
  seed: number;
  cols: number;
  nodes: JourneyNode[];
  currentId: number; // 현재 서 있는 노드
}

export const NODE_INFO: Record<NodeKind, { icon: string; name: string; color: string }> = {
  start: { icon: '🚩', name: '출발지', color: '#8d9bb5' },
  battle: { icon: '⚔️', name: '전투', color: '#ff5d7e' },
  town: { icon: '🏘️', name: '마을', color: '#ffd166' },
  treasure: { icon: '💰', name: '보물', color: '#7be07a' },
  camp: { icon: '🏕️', name: '야영', color: '#8de0e0' },
  boss: { icon: '👑', name: '적장', color: '#c06bff' },
};

// 원정 하나를 생성 — 단계(col)마다 1~3개의 노드, 인접 단계끼리만 연결.
// 중간에 마을이 반드시 하나는 나오도록 보장한다 (정비 없이 보스까지 갈 수 없게).
export function generateJourney(seed: number, cols = 8): Journey {
  const rand = mulberry32(seed * 1013904223 + 7);
  const nodes: JourneyNode[] = [];
  const byCol: JourneyNode[][] = [];
  let id = 0;

  for (let col = 0; col < cols; col++) {
    const count = col === 0 || col === cols - 1 ? 1 : 2 + (rand() < 0.45 ? 1 : 0);
    const list: JourneyNode[] = [];
    for (let row = 0; row < count; row++) {
      const node: JourneyNode = {
        id: id++,
        col,
        row,
        rows: count,
        kind: col === 0 ? 'start' : col === cols - 1 ? 'boss' : 'battle',
        next: [],
        visited: false,
      };
      list.push(node);
      nodes.push(node);
    }
    byCol.push(list);
  }

  // 길 잇기 — 같은 높이 비율끼리 우선 연결하고, 가끔 갈래를 하나 더 낸다.
  for (let col = 0; col < cols - 1; col++) {
    const cur = byCol[col];
    const nxt = byCol[col + 1];
    for (const n of cur) {
      const ratio = cur.length === 1 ? 0.5 : n.row / (cur.length - 1);
      const target = Math.round(ratio * (nxt.length - 1));
      n.next.push(nxt[target].id);
      // 갈래 추가 (위 또는 아래 이웃)
      if (rand() < 0.5) {
        const alt = target + (rand() < 0.5 ? -1 : 1);
        if (alt >= 0 && alt < nxt.length && !n.next.includes(nxt[alt].id)) n.next.push(nxt[alt].id);
      }
    }
    // 들어오는 길이 없는 노드가 없도록 보정 (막다른 지도 방지)
    for (const t of nxt) {
      if (cur.some((n) => n.next.includes(t.id))) continue;
      const ratio = nxt.length === 1 ? 0.5 : t.row / (nxt.length - 1);
      const from = cur[Math.round(ratio * (cur.length - 1))];
      from.next.push(t.id);
    }
  }

  // 노드 종류 — 전투가 기본, 사이사이 보물·야영, 중반에 마을 보장
  const middle = nodes.filter((n) => n.col > 0 && n.col < cols - 1);
  for (const n of middle) {
    const r = rand();
    n.kind = r < 0.58 ? 'battle' : r < 0.76 ? 'treasure' : r < 0.9 ? 'camp' : 'town';
  }
  // 마을 보장 — 지도 어딘가가 아니라 **출발지에서 실제로 닿는** 마을이 하나는 있어야 한다.
  // (예전엔 midCols 아무 데나 하나 뒀는데, 갈림길 때문에 그 마을이 안 지나는 길에 놓이면
  //  그 원정은 영입 기회 없이 끝났다 — 측정: 완주율이 영입 50% ↔ 미영입 0%로 갈렸다.)
  const reachable = reachableFrom(nodes, 0);
  const reachableMid = middle.filter((n) => reachable.has(n.id));
  if (reachableMid.length && !reachableMid.some((n) => n.kind === 'town')) {
    // 되도록 이른 단계에 둔다 — 일찍 영입할수록 남은 전투를 4명으로 치러 경험치가 붙는다
    const earliest = Math.min(...reachableMid.map((n) => n.col));
    pick(rand, reachableMid.filter((n) => n.col === earliest)).kind = 'town';
  }
  // 보스 직전 단계에는 정비 기회를 하나 준다 (마을 또는 야영)
  const preBoss = nodes.filter((n) => n.col === cols - 2);
  if (preBoss.length && !preBoss.some((n) => n.kind === 'town' || n.kind === 'camp')) {
    pick(rand, preBoss).kind = 'camp';
  }

  nodes[0].visited = true;
  return { seed, cols, nodes, currentId: 0 };
}

// 출발 노드에서 앞으로 이어진 길로 닿을 수 있는 노드 id 집합
function reachableFrom(nodes: JourneyNode[], startId: number): Set<number> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<number>([startId]);
  const stack = [startId];
  while (stack.length) {
    const n = byId.get(stack.pop()!);
    if (!n) continue;
    for (const next of n.next) if (!seen.has(next)) { seen.add(next); stack.push(next); }
  }
  return seen;
}

export const nodeById = (j: Journey, id: number) => j.nodes.find((n) => n.id === id)!;

// 지금 갈 수 있는 노드들 (현재 노드에서 이어진 길)
export const nextNodes = (j: Journey): JourneyNode[] =>
  nodeById(j, j.currentId).next.map((id) => nodeById(j, id));

// 노드로 이동 (길이 이어져 있을 때만)
export function travelTo(j: Journey, id: number): Journey {
  if (!nodeById(j, j.currentId).next.includes(id)) return j;
  const nodes = j.nodes.map((n) => (n.id === id ? { ...n, visited: true } : n));
  return { ...j, nodes, currentId: id };
}

// 단계(col)가 깊을수록 적이 강해진다 — 전투 난이도 스케일의 단일 출처
export const tierOf = (j: Journey, id: number) => nodeById(j, id).col;
