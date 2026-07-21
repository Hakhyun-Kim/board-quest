import { useCallback, useEffect, useMemo, useState, type MutableRefObject } from 'react';
import { Canvas } from '@react-three/fiber';
import BattleScene, { type Highlights } from '../three/BattleScene';
import {
  canUseSkill,
  currentUnit,
  doHeal,
  doItem,
  doMove,
  doPlannedAttack,
  doSkill,
  doWait,
  healTargets,
  itemTargets,
  movesFor,
  reachableAttacks,
  skillOf,
  skillTargets,
  undoMove,
  type BattleState,
} from '../lib/battle';
import { autoAct } from '../lib/autoPlay';
import { key, unitAt } from '../lib/board';
import { sfx } from '../lib/sound';
import type { Unit } from '../lib/units';
import {
  ActionMenu,
  BattleLog,
  TargetPreview,
  TurnOrderBar,
  UnitCard,
  type BattleMode,
} from './BattleHud';

// 전투 화면 통째 — 보드(3D) + HUD + 조작.
//
// 1인 원정과 2인 대전이 **같은 화면을 쓴다.** 둘의 차이는 오직 `canControl`뿐:
// 지금 차례인 말을 사람이 조작할 수 있으면 조작 UI를 열고, 아니면 봇(autoAct)이 대신 둔다.
// 덕분에 '적 차례 자동 진행'과 '봇에게 맡긴 아군'이 한 갈래로 처리된다.
export default function BattleView({
  state,
  setState,
  canControl,
  turnLabel,
  muted,
  onToggleMute,
  tileRef,
  hoverRef,
}: {
  state: BattleState;
  setState: (s: BattleState | ((prev: BattleState) => BattleState)) => void;
  /** 이 말을 지금 사람이 조작하는가 (false면 봇이 둔다) */
  canControl: (u: Unit) => boolean;
  /** 차례 배너 — 2인 모드에서 "🔵 1P 차례" 같은 안내 (없으면 표시 안 함) */
  turnLabel?: (u: Unit) => string | null;
  muted: boolean;
  onToggleMute: () => void;
  /** 검증용 훅 — 보드 클릭 / 마지막으로 읽힌 칸 */
  tileRef?: MutableRefObject<(x: number, y: number) => void>;
  hoverRef?: MutableRefObject<[number, number] | null>;
}) {
  const [mode, setMode] = useState<BattleMode>({ kind: 'idle' });
  const [inspectId, setInspectId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null); // 마우스가 올라간 말 (터치엔 없음)

  const unit = currentUnit(state);
  const mine = !!unit && !state.result && canControl(unit);

  // 차례가 바뀌면 모드·고정 정보를 털어 준다 (앞 사람이 열어 둔 메뉴가 남지 않게)
  useEffect(() => {
    setMode({ kind: 'idle' });
    setInspectId(null);
  }, [unit?.id, state.round]);

  // ── 사람이 조작하지 않는 말은 봇이 둔다 (적 차례 · 자동으로 맡긴 아군 모두)
  useEffect(() => {
    if (state.result || !unit || canControl(unit)) return;
    const t = setTimeout(() => {
      setState((s) => {
        const u = currentUnit(s);
        return s.result || !u || canControl(u) ? s : autoAct(s);
      });
      sfx.hit();
    }, 550);
    return () => clearTimeout(t);
  }, [state, unit, canControl, setState]);

  // 이번 턴에 때릴 수 있는 적 전부 (이동해서 닿는 것 포함) — 하이라이트와 클릭이 같은 계획을 쓴다
  const plans = useMemo(
    () => (unit && mine ? reachableAttacks(state, unit) : new Map()),
    [state, unit, mine],
  );

  // ── 하이라이트 (이동 파랑 / 지금 칠 수 있는 적 빨강 / 이동해야 닿는 적 주황)
  const highlights: Highlights = useMemo(() => {
    const empty: Highlights = {
      move: new Set(),
      target: new Set(),
      threat: new Set(),
      path: new Set(),
    };
    if (!unit || !mine) return empty;
    if (mode.kind === 'heal') {
      return { ...empty, target: new Set(healTargets(state, unit).map((t) => key(t.x, t.y))) };
    }
    if (mode.kind === 'skill') {
      return { ...empty, target: new Set(skillTargets(state, unit).map((t) => key(t.x, t.y))) };
    }
    if (mode.kind === 'item') {
      return {
        ...empty,
        target: new Set(itemTargets(state, unit, mode.itemId).map((t) => key(t.x, t.y))),
      };
    }
    // idle — 갈 수 있는 칸(파랑) + 지금 칠 수 있는 적(빨강) + 이동하면 닿는 적(주황).
    //        "저기까지 가서 때릴 수 있나"를 손으로 세어 보지 않아도 되게 미리 칠해 준다.
    const m = new Set<string>();
    if (!state.moved) movesFor(state, unit).forEach((t) => m.add(key(t.x, t.y)));
    const now = new Set<string>();
    const after = new Set<string>();
    for (const [id, p] of plans) {
      const t = state.units.find((x) => x.id === id);
      if (!t) continue;
      (p.moves ? after : now).add(key(t.x, t.y));
    }
    return { ...empty, move: m, target: now, threat: after };
  }, [state, unit, mode, mine, plans]);

  // ── 보드 클릭
  const onTile = useCallback(
    (x: number, y: number) => {
      if (state.result) return;
      const u = currentUnit(state);
      if (!u || !canControl(u)) return;
      const target = unitAt(state.units, x, y);

      if (mode.kind === 'skill') {
        if (target && skillTargets(state, u).some((t) => t.id === target.id)) {
          setState(doSkill(state, target.id));
          setMode({ kind: 'idle' });
          setInspectId(null);
          sfx.hit();
        } else sfx.cancel();
        return;
      }
      if (mode.kind === 'heal' && target && target.side === u.side) {
        setState(doHeal(state, target.id));
        setMode({ kind: 'idle' });
        sfx.heal();
        return;
      }
      if (mode.kind === 'item' && target) {
        const ok = itemTargets(state, u, mode.itemId).some((t) => t.id === target.id);
        if (ok) {
          setState(doItem(state, mode.itemId, target.id));
          setMode({ kind: 'idle' });
          sfx.item();
        } else sfx.cancel();
        return;
      }
      // ── idle — 메뉴를 거치지 않는 직접 조작이 기본이다.
      //    적을 누르면 곧장 공격, 파란 칸을 누르면 곧장 이동.
      if (target && target.side !== u.side) {
        const plan = plans.get(target.id);
        if (plan) {
          // 이동이 필요하면 이동까지 한 번에 — 일일이 옮겨 놓고 확인할 필요 없게
          if (plan.moves) sfx.move();
          setState(doPlannedAttack(state, plan));
          setInspectId(null);
          sfx.hit();
        } else {
          // 이번 턴엔 닿지 않는다 — 때리는 대신 정보만
          setInspectId(target.id);
          sfx.cancel();
        }
        return;
      }
      if (!target && !state.moved && movesFor(state, u).has(key(x, y))) {
        setState(doMove(state, x, y));
        sfx.move();
        return;
      }
      // 그 외(아군·빈 칸 밖) — 정보 확인
      setInspectId(target ? target.id : null);
    },
    [state, mode, plans, canControl, setState],
  );
  if (tileRef) tileRef.current = onTile;

  // 우클릭 — 행동하지 않고 상세 정보만 (오조작 없이 적을 살펴볼 수 있게)
  const onInspectTile = useCallback(
    (x: number, y: number) => {
      const target = unitAt(state.units, x, y);
      setInspectId(target ? target.id : null);
      if (target) sfx.select();
    },
    [state],
  );

  const onHoverTile = useCallback(
    (x: number, y: number | null) => {
      if (hoverRef) hoverRef.current = y === null ? null : [x, y];
      if (y === null) return setHoverId(null);
      setHoverId(unitAt(state.units, x, y)?.id ?? null);
    },
    [state, hoverRef],
  );

  // 고정(우클릭)이 우선, 없으면 마우스가 올라간 말을 보여 준다 —
  // 덕분에 적 위에 커서만 올려도 예상 피해를 미리 볼 수 있다.
  const shownId = inspectId ?? hoverId;
  const inspectUnit = shownId ? state.units.find((u) => u.id === shownId) : null;
  const banner = unit && turnLabel ? turnLabel(unit) : null;

  return (
    <>
      <Canvas
        className="canvas"
        camera={{ fov: 50, position: [0, 18, 13] }}
        dpr={[1, 2]}
        onContextMenu={(e) => e.preventDefault()} // 우클릭은 '정보 보기'로 쓴다
      >
        <color attach="background" args={['#131a26']} />
        <BattleScene
          state={state}
          highlights={highlights}
          onTile={onTile}
          onInspect={onInspectTile}
          onHover={onHoverTile}
        />
      </Canvas>

      <div className="battle-ui">
        <div className="battle-top">
          <TurnOrderBar state={state} />
          <button className="chip mute-btn" onClick={onToggleMute}>
            {muted ? '🔇' : '🔊'}
          </button>
        </div>

        {banner && !state.result && (
          <div className={`turn-banner ${unit!.side}`}>{banner}</div>
        )}

        <div className="battle-side">
          {unit && <UnitCard unit={unit} state={state} />}
          {inspectUnit && unit && inspectUnit.id !== unit.id && (
            <>
              <UnitCard unit={inspectUnit} state={state} />
              {inspectUnit.side !== unit.side &&
                (() => {
                  // 이동해서 때릴 상대면, 실제로 설 자리 기준으로 미리 본다
                  // (언덕·숲 보정이 달라지므로 제자리 기준으로 보여 주면 수치가 어긋난다)
                  const p = mode.kind === 'idle' ? plans.get(inspectUnit.id) : undefined;
                  const from = p ? { ...unit, x: p.x, y: p.y } : unit;
                  return (
                    <TargetPreview
                      state={state}
                      attacker={from}
                      target={inspectUnit}
                      skill={mode.kind === 'skill' ? skillOf(unit) : null}
                      movesFirst={!!p?.moves}
                    />
                  );
                })()}
            </>
          )}
          <BattleLog log={state.log} />
        </div>

        <div className="battle-bottom">
          {mine && unit ? (
            <ActionMenu
              state={state}
              unit={unit}
              mode={mode}
              canHeal={unit.cls === 'staff' && healTargets(state, unit).length > 0}
              canSkill={canUseSkill(state, unit)}
              items={state.items[unit.side]}
              onSkill={() => {
                // 대상을 고를 필요가 없는 특기(회전베기·기도)는 바로 발동한다
                const def = skillOf(unit);
                sfx.select();
                if (def && def.target === 'self') {
                  setState(doSkill(state, null));
                  setMode({ kind: 'idle' });
                } else {
                  setMode({ kind: 'skill' });
                }
              }}
              onHeal={() => {
                sfx.select();
                setMode({ kind: 'heal' });
              }}
              onItem={(id) => {
                sfx.select();
                setMode({ kind: 'item', itemId: id });
              }}
              onWait={() => {
                sfx.tap();
                setState(doWait(state));
                setMode({ kind: 'idle' });
              }}
              onUndo={() => {
                sfx.cancel();
                setState(undoMove(state));
              }}
              onCancel={() => {
                sfx.cancel();
                setMode({ kind: 'idle' });
              }}
            />
          ) : (
            <p className="waiting">
              {state.result ? '전투 종료…' : `${unit?.name ?? '적'}의 차례…`}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
