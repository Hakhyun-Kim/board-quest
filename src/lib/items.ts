// 아이템 — 전투 중 '행동' 대신 사용한다 (이동 후에도 사용 가능).
// 데이터만 있는 순수 모듈. 실제 효과 적용은 battle.ts.

export type ItemTarget = 'ally' | 'foe';

export interface ItemDef {
  id: string;
  icon: string;
  name: string;
  desc: string;
  target: ItemTarget;
  range: number; // 사용 사거리 (맨해튼)
  heal?: number;
  damage?: number;
  splash?: boolean; // 대상 인접 칸까지 피해
  buffAtk?: number;
  price: number;
}

export const ITEMS: Record<string, ItemDef> = {
  potion: {
    id: 'potion', icon: '🧪', name: '회복약', desc: '아군 하나의 체력을 22 회복',
    target: 'ally', range: 2, heal: 22, price: 30,
  },
  bomb: {
    id: 'bomb', icon: '💣', name: '폭탄', desc: '적과 그 인접 칸에 14 피해',
    target: 'foe', range: 3, damage: 14, splash: true, price: 45,
  },
  whetstone: {
    id: 'whetstone', icon: '🪨', name: '숫돌', desc: '아군 하나의 공격력 +5 (이번 전투)',
    target: 'ally', range: 1, buffAtk: 5, price: 40,
  },
};

export type Inventory = Record<string, number>;

export const hasItem = (inv: Inventory, id: string) => (inv[id] ?? 0) > 0;

export function useItem(inv: Inventory, id: string): Inventory {
  const n = { ...inv };
  n[id] = Math.max(0, (n[id] ?? 0) - 1);
  if (n[id] === 0) delete n[id];
  return n;
}

export function addItem(inv: Inventory, id: string, count = 1): Inventory {
  return { ...inv, [id]: (inv[id] ?? 0) + count };
}
