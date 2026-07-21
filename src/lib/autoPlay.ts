// 자동 조작 — '봇이 대신 두는 한 수'.
//
// 원래는 밸런스 시뮬레이터(dev/simBot.ts) 전용 아군 AI였는데, 2인 대전에서
// **한쪽 진영(또는 몇몇 말)을 봇에게 맡기는 기능**이 같은 판단을 필요로 해 lib으로 올렸다.
// 시뮬레이터가 재는 수와 게임에서 봇이 두는 수가 같아야, 측정한 밸런스가 실제와 어긋나지 않는다.
import {
  canUseSkill,
  currentUnit,
  doMove,
  doPlannedAttack,
  doSkill,
  doWait,
  foeAct,
  healTargets,
  movesFor,
  reachableAttacks,
  skillOf,
  skillTargets,
  type BattleState,
} from './battle';
import { dist } from './board';

// ── 아군 AI (간이) — 사람이 둘 법한 무난한 수를 둔다.
// 목적은 '최적 플레이'가 아니라 '일관된 기준'이다. 같은 기준으로 전후를 비교해야
// 밸런스 변화가 보인다.
export function allyAct(s0: BattleState): BattleState {
  const u = currentUnit(s0);
  if (!u || u.side !== 'ally') return s0;

  // 1) 특기가 확실히 이득일 때 쓴다
  if (canUseSkill(s0, u)) {
    const def = skillOf(u);
    if (def) {
      if (def.healMul) {
        // 기도 — 아군 둘 이상이 다쳤을 때만 (혼자 살짝 깎인 정도면 아낀다)
        const hurt = healTargets(s0, u).filter((t) => t.hp < t.maxHp * 0.7).length;
        if (hurt >= 2) return doSkill(s0, null);
      } else if (def.area === 'adjacent') {
        // 회전베기 — 인접한 적이 둘 이상이면
        if (skillTargets(s0, u).length >= 2) return doSkill(s0, null);
      } else {
        // 저격·관통 — 닿는 적이 있으면 가장 약한 쪽에
        const targets = skillTargets(s0, u);
        if (targets.length) {
          const t = targets.slice().sort((a, b) => a.hp - b.hp)[0];
          return doSkill(s0, t.id);
        }
      }
    }
  }

  // 2) 때릴 수 있으면 가장 이득인 표적을 (이동 후 공격 포함)
  const plans = [...reachableAttacks(s0, u).values()];
  if (plans.length) {
    const best = plans
      .map((p) => {
        const t = s0.units.find((x) => x.id === p.targetId)!;
        const kill = p.dmg >= t.hp;
        return { p, score: (kill ? 1000 : 0) + p.dmg * 2 - p.counter * 1.5 - t.hp * 0.1 };
      })
      .sort((a, b) => b.score - a.score)[0];
    return doPlannedAttack(s0, best.p);
  }

  // 3) 못 때리면 가장 가까운 적 쪽으로 접근
  const foes = s0.units.filter((t) => t.alive && t.side === 'foe');
  if (foes.length && !s0.moved) {
    let best: { x: number; y: number; d: number } | null = null;
    for (const tile of movesFor(s0, u).values()) {
      const d = Math.min(...foes.map((f) => dist(tile.x, tile.y, f.x, f.y)));
      if (!best || d < best.d) best = { x: tile.x, y: tile.y, d };
    }
    if (best && (best.x !== u.x || best.y !== u.y)) {
      // 접근만 하고 턴을 넘긴다
      const moved = doMove(s0, best.x, best.y);
      if (moved !== s0) return doWait(moved);
    }
  }
  return doWait(s0);
}

/**
 * 지금 차례인 말을 진영에 맞는 AI로 한 수 둔다.
 * 아군 쪽은 `allyAct`, 적 쪽은 `foeAct` — 대전에서 어느 진영이든 봇에게 맡길 수 있게.
 */
export function autoAct(s: BattleState): BattleState {
  const u = currentUnit(s);
  if (!u) return s;
  return u.side === 'ally' ? allyAct(s) : foeAct(s);
}
