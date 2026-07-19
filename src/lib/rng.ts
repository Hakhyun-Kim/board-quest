// 시드 고정 난수 (mulberry32) — 같은 시드는 언제나 같은 결과.
// 지도·전투 보드·판정에 모두 이 난수를 쓰면 "같은 판을 다시 재현"할 수 있고,
// 헤드리스 시뮬레이션으로 밸런스를 측정할 수 있다.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 전투 판정용 — 상태(seed)를 들고 다니며 순수하게 굴리는 난수.
// next(state) → [0~1 값, 다음 상태]. 전투 상태에 seed를 넣어 두면 리플레이가 가능하다.
export function nextRand(seed: number): [number, number] {
  const s = (seed + 0x6d2b79f5) >>> 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s];
}

// 배열에서 하나 뽑기 (시드 난수 함수를 받아 사용)
export const pick = <T>(rand: () => number, arr: readonly T[]): T =>
  arr[Math.floor(rand() * arr.length)];
