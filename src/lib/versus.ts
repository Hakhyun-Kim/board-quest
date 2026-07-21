// 2인 대전 원정 — 하나의 지도를 **양끝에서 마주 보고** 진격한다.
//
// 규칙
//  · 1P는 왼쪽 끝(col 0)에서 오른쪽으로, 2P는 오른쪽 끝(col cols-1)에서 왼쪽으로 나아간다.
//  · 한 번에 한 진영씩 번갈아 노드 하나를 밟고, 그 노드의 일(전투·마을·보물·야영)을 치른다.
//  · 서로 다가오므로 **같은 단계(col)에 서면 조우** — 그 자리에서 원정대끼리 대전한다.
//  · 대전에서 상대 원정대를 전멸시킨 쪽이 승리. 보스 노드는 이 모드에서 쓰지 않는다.
//
// 지도는 **좌우 대칭**으로 생성한다. 만나기 전 각자 서너 노드밖에 못 밟는데 그 종류가
// 운으로 갈리면(한쪽은 전투 셋, 한쪽은 마을+보물) 승부가 지도로 정해져 버린다.
// 대칭이면 "같은 기회를 어떻게 썼는가"만 남는다.
import type { Inventory } from './items';
import { NODE_INFO, type Journey, type JourneyNode, type NodeKind } from './journey';
import { mulberry32, pick } from './rng';
import type { Unit } from './units';

export type PlayerId = 'p1' | 'p2';

export const PLAYERS: Record<PlayerId, { name: string; icon: string; color: string }> = {
  p1: { name: '1P', icon: '🔵', color: '#5aa0ff' },
  p2: { name: '2P', icon: '🔴', color: '#ff5d7e' },
};

export const other = (p: PlayerId): PlayerId => (p === 'p1' ? 'p2' : 'p1');

/** 한 진영의 원정 상태 — 각자 따로 성장하고 따로 물자를 모은다 */
export interface Camp {
  id: PlayerId;
  nodeId: number;
  party: Unit[];
  gold: number;
  inventory: Inventory;
}

export interface VersusState {
  journey: Journey;
  camps: Record<PlayerId, Camp>;
  turn: PlayerId; // 지금 길을 고를 차례
  met: boolean; // 조우했는가 (= 대전 시작)
}

// ── 대칭 지도 생성 ─────────────────────────────────────────────
// 왼쪽 절반만 굴리고 오른쪽은 거울로 뜬다. 거울 좌표는 mirror(col,row) = (cols-1-col, row).
export function generateVersusJourney(seed: number, cols = 8): Journey {
  const rand = mulberry32(seed * 1013904223 + 7);
  const mirrorCol = (c: number) => cols - 1 - c;
  const isLeft = (c: number) => c <= mirrorCol(c); // 직접 굴리는 쪽 (가운데 열 포함)

  // 열마다 노드 수 — 거울 쪽은 그대로 베낀다
  const counts: number[] = [];
  for (let c = 0; c < cols; c++) {
    if (c === 0 || c === cols - 1) counts[c] = 1;
    else if (isLeft(c)) counts[c] = 2 + (rand() < 0.45 ? 1 : 0);
    else counts[c] = counts[mirrorCol(c)];
  }

  const nodes: JourneyNode[] = [];
  const byCol: JourneyNode[][] = [];
  let id = 0;
  for (let col = 0; col < cols; col++) {
    const list: JourneyNode[] = [];
    for (let row = 0; row < counts[col]; row++) {
      const node: JourneyNode = {
        id: id++,
        col,
        row,
        rows: counts[col],
        kind: 'battle',
        next: [],
        visited: false,
      };
      list.push(node);
      nodes.push(node);
    }
    byCol.push(list);
  }

  // ── 길 잇기. 열 쌍 p = (col p, col p+1). 쌍 p의 거울은 쌍 cols-2-p.
  const link = (a: JourneyNode, b: JourneyNode) => {
    if (!a.next.includes(b.id)) a.next.push(b.id);
  };
  const mirrorPair = (p: number) => cols - 2 - p;

  for (let p = 0; p < cols - 1; p++) {
    if (p > mirrorPair(p)) continue; // 거울 쪽은 나중에 베낀다
    const cur = byCol[p];
    const nxt = byCol[p + 1];
    for (const n of cur) {
      const ratio = cur.length === 1 ? 0.5 : n.row / (cur.length - 1);
      const target = Math.round(ratio * (nxt.length - 1));
      link(n, nxt[target]);
      if (rand() < 0.5) {
        const alt = target + (rand() < 0.5 ? -1 : 1);
        if (alt >= 0 && alt < nxt.length) link(n, nxt[alt]);
      }
    }
    // 들어오는 길이 없는 노드가 없도록 (막다른 지도 방지 — 2P는 이 길을 거꾸로 걷는다)
    for (const t of nxt) {
      if (cur.some((n) => n.next.includes(t.id))) continue;
      const ratio = nxt.length === 1 ? 0.5 : t.row / (nxt.length - 1);
      link(cur[Math.round(ratio * (cur.length - 1))], t);
    }
    // 한가운데 쌍은 자기 자신이 거울이라, 뒤집은 간선을 스스로에게 더해 대칭을 맞춘다
    if (p === mirrorPair(p)) {
      for (const n of [...cur]) {
        for (const tid of [...n.next]) {
          const t = nodes.find((x) => x.id === tid)!;
          if (cur[t.row] && nxt[n.row]) link(cur[t.row], nxt[n.row]);
        }
      }
    }
  }
  // 거울 쪽 간선 — 왼쪽 간선 (p,r)→(p+1,r2) 를 (cols-2-p, r2)→(cols-1-p, r) 로 옮긴다
  for (let p = 0; p < cols - 1; p++) {
    const mp = mirrorPair(p);
    if (p >= mp) continue;
    for (const n of byCol[p]) {
      for (const tid of n.next) {
        const t = nodes.find((x) => x.id === tid)!;
        link(byCol[mp][t.row], byCol[mp + 1][n.row]);
      }
    }
  }

  // ── 노드 종류 — 직접 굴리는 쪽만 정하고 거울로 베낀다
  const drawn = nodes.filter((n) => n.col > 0 && n.col < cols - 1 && isLeft(n.col));
  for (const n of drawn) {
    const r = rand();
    n.kind = r < 0.58 ? 'battle' : r < 0.76 ? 'treasure' : r < 0.9 ? 'camp' : 'town';
  }
  // 마을 보장 — 만나기 전에 영입·회복할 기회가 한 번은 있어야 한다 (되도록 이른 단계)
  if (drawn.length && !drawn.some((n) => n.kind === 'town')) {
    const earliest = Math.min(...drawn.map((n) => n.col));
    pick(rand, drawn.filter((n) => n.col === earliest)).kind = 'town';
  }
  for (const n of nodes) {
    if (n.col === 0 || n.col === cols - 1) {
      n.kind = 'start';
      n.visited = true;
    } else if (!isLeft(n.col)) {
      n.kind = byCol[mirrorCol(n.col)][n.row].kind;
    }
  }

  return { seed, cols, nodes, currentId: 0 };
}

// ── 조회 ───────────────────────────────────────────────────────
export const nodeOf = (j: Journey, id: number) => j.nodes.find((n) => n.id === id)!;

/** 이 노드로 들어오는 길 (2P는 지도를 거꾸로 걷는다) */
export const prevNodes = (j: Journey, id: number): JourneyNode[] =>
  j.nodes.filter((n) => n.next.includes(id));

/** 지금 차례인 진영이 갈 수 있는 노드들 */
export function choicesFor(v: VersusState, who: PlayerId): JourneyNode[] {
  const cur = nodeOf(v.journey, v.camps[who].nodeId);
  return who === 'p1'
    ? cur.next.map((id) => nodeOf(v.journey, id))
    : prevNodes(v.journey, cur.id);
}

/** 그 진영 기준의 난이도 단계 — 출발지에서 몇 걸음 왔는가 (양쪽이 같은 곡선을 탄다) */
export const tierFor = (j: Journey, who: PlayerId, col: number) =>
  who === 'p1' ? col : j.cols - 1 - col;

export const campCol = (v: VersusState, who: PlayerId) => nodeOf(v.journey, v.camps[who].nodeId).col;

/** 남은 걸음 수 (조우까지 대략 몇 노드인가) — 화면 안내용 */
export const stepsToMeet = (v: VersusState) => Math.max(0, campCol(v, 'p2') - campCol(v, 'p1'));

// ── 이동 ───────────────────────────────────────────────────────
export function createVersus(
  seed: number,
  p1: Omit<Camp, 'id' | 'nodeId'>,
  p2: Omit<Camp, 'id' | 'nodeId'>,
  cols = 8,
): VersusState {
  const journey = generateVersusJourney(seed, cols);
  const last = journey.nodes[journey.nodes.length - 1];
  return {
    journey,
    camps: {
      p1: { id: 'p1', nodeId: 0, ...p1 },
      p2: { id: 'p2', nodeId: last.id, ...p2 },
    },
    turn: 'p1',
    met: false,
  };
}

/** 길을 하나 밟는다. 밟은 노드의 종류를 같이 돌려준다 (조우면 kind는 무시) */
export function moveCamp(
  v: VersusState,
  who: PlayerId,
  nodeId: number,
): { state: VersusState; kind: NodeKind; met: boolean } | null {
  if (v.met) return null;
  if (!choicesFor(v, who).some((n) => n.id === nodeId)) return null;
  const journey: Journey = {
    ...v.journey,
    nodes: v.journey.nodes.map((n) => (n.id === nodeId ? { ...n, visited: true } : n)),
  };
  const state: VersusState = {
    ...v,
    journey,
    camps: { ...v.camps, [who]: { ...v.camps[who], nodeId } },
  };
  // 조우 판정 — 서로 마주 오므로 같은 단계에 서면 들판에서 마주친다
  const met = campCol(state, 'p1') >= campCol(state, 'p2');
  return { state: { ...state, met }, kind: nodeOf(journey, nodeId).kind, met };
}

/** 차례 넘기기 (노드에서 할 일을 다 마친 뒤) */
export const passTurn = (v: VersusState): VersusState => ({ ...v, turn: other(v.turn) });

export const nodeLabel = (kind: NodeKind) => `${NODE_INFO[kind].icon} ${NODE_INFO[kind].name}`;
