import { generateVersusJourney, prevNodes } from '../lib/versus';

let bad = 0;
for (let seed = 1; seed <= 300; seed++) {
  const j = generateVersusJourney(seed, 8);
  const at = (c: number, r: number) => j.nodes.find((n) => n.col === c && n.row === r)!;
  const mc = (c: number) => j.cols - 1 - c;
  // 1) 열 크기·종류 대칭
  for (const n of j.nodes) {
    const m = at(mc(n.col), n.row);
    if (!m) { console.log(seed, '거울 노드 없음', n.col, n.row); bad++; continue; }
    if (m.kind !== n.kind) { console.log(seed, '종류 비대칭', n.col, n.row, n.kind, m.kind); bad++; }
  }
  // 2) 간선 대칭 — (c,r)->(c+1,r2) 가 있으면 (mc(c+1),r2)->(mc(c),r) 도 있어야
  for (const n of j.nodes) {
    for (const id of n.next) {
      const t = j.nodes.find((x) => x.id === id)!;
      const a = at(mc(t.col), t.row);
      const b = at(mc(n.col), n.row);
      if (!a.next.includes(b.id)) { console.log(seed, '간선 비대칭', n.col, n.row, '->', t.col, t.row); bad++; }
    }
  }
  // 3) 양쪽 다 끝까지 걸을 수 있는가 (막다른 길 없음)
  for (const n of j.nodes) {
    if (n.col < j.cols - 1 && n.next.length === 0) { console.log(seed, '앞길 없음', n.col, n.row); bad++; }
    if (n.col > 0 && prevNodes(j, n.id).length === 0) { console.log(seed, '뒷길 없음', n.col, n.row); bad++; }
  }
  // 4) 만나기 전 구간(col 1..3)에 마을이 있는가
  const mid = j.nodes.filter((n) => n.col >= 1 && n.col <= 3);
  if (!mid.some((n) => n.kind === 'town')) { console.log(seed, '마을 없음'); bad++; }
  // 5) 양끝은 출발지
  if (j.nodes[0].kind !== 'start' || j.nodes[j.nodes.length - 1].kind !== 'start') { console.log(seed, '출발지 아님'); bad++; }
}
console.log(bad === 0 ? '✅ 300개 지도 전부 대칭·연결·마을 보장 OK' : `❌ 문제 ${bad}건`);
