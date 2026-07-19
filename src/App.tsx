import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import BattleScene, { type Highlights } from './three/BattleScene';
import {
  attackTargets,
  canUseSkill,
  createBattle,
  currentUnit,
  doAttack,
  doHeal,
  doItem,
  doMove,
  doSkill,
  doWait,
  foeAct,
  healTargets,
  itemTargets,
  movesFor,
  skillOf,
  skillTargets,
  undoMove,
  type BattleState,
} from './lib/battle';
import { key, unitAt } from './lib/board';
import { battleGold, buildEncounter } from './lib/encounter';
import { addItem, ITEMS, type Inventory } from './lib/items';
import {
  generateJourney,
  nodeById,
  travelTo,
  type Journey,
  type NodeKind,
} from './lib/journey';
import { mulberry32, pick } from './lib/rng';
import { isMuted, setMuted, sfx } from './lib/sound';
import { useLocalStorage } from './lib/store';
import { CLASSES, makeUnit, type ClassId, type Unit } from './lib/units';
import {
  ActionMenu,
  BattleLog,
  TargetPreview,
  TurnOrderBar,
  UnitCard,
  type BattleMode,
} from './ui/BattleHud';
import JourneyScreen from './ui/JourneyScreen';
import TownScreen, { HEAL_COST, PARTY_MAX, RECRUIT_COST } from './ui/TownScreen';
import {
  BattleResultScreen,
  CampScreen,
  EndingScreen,
  TitleScreen,
  TreasureScreen,
} from './ui/Screens';

// 흐름: title → journey(길 선택) → 노드별 화면(battle / town / treasure / camp)
//        → 다시 journey … → 마지막 노드(boss) 승리 시 ending
type Phase = 'title' | 'journey' | 'battle' | 'result' | 'town' | 'treasure' | 'camp' | 'ending';

const START_PARTY: ClassId[] = ['sword', 'bow', 'staff'];
const START_GOLD = 60;
const RECRUIT_POOL: ClassId[] = ['spear', 'sword', 'bow', 'staff'];

export default function App() {
  const [phase, setPhase] = useState<Phase>('title');
  const [journey, setJourney] = useState<Journey | null>(null);
  const [party, setParty] = useState<Unit[]>([]);
  const [gold, setGold] = useState(START_GOLD);
  const [inventory, setInventory] = useState<Inventory>({ potion: 2 });
  const [battle, setBattle] = useState<BattleState | null>(null);
  const [mode, setMode] = useState<BattleMode>({ kind: 'idle' });
  const [inspectId, setInspectId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null); // 마우스가 올라간 말 (터치엔 없음)
  const [reward, setReward] = useState({ gold: 0, exp: 0, item: null as string | null, heal: 0 });
  const [best, setBest] = useLocalStorage<number>('bq-best', 0);
  const [muted, setMutedState] = useState(isMuted());

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    setMutedState(next);
    if (!next) sfx.tap();
  };

  // ── 원정 시작 (새 지도 + 기본 원정대)
  const startRun = () => {
    sfx.march();
    const seed = Math.floor(Math.random() * 100000);
    setJourney(generateJourney(seed));
    setParty(START_PARTY.map((cls, i) => makeUnit(`ally-${i}`, cls, 1, 0, 0)));
    setGold(START_GOLD);
    setInventory({ potion: 2 });
    setBattle(null);
    setPhase('journey');
  };

  // ── 길 이동 → 노드 종류에 따라 화면 분기
  const travel = (id: number) => {
    if (!journey) return;
    const j = travelTo(journey, id);
    if (j === journey) return; // 이어지지 않은 길
    setJourney(j);
    const node = nodeById(j, id);
    if (node.col > best) setBest(node.col);
    resolveNode(j, node.kind, id);
  };

  const resolveNode = (j: Journey, kind: NodeKind, nodeId: number) => {
    const tier = nodeById(j, nodeId).col;
    const rand = mulberry32(j.seed * 31 + nodeId * 17 + 3);
    if (kind === 'battle' || kind === 'boss') {
      sfx.turn();
      const isBoss = kind === 'boss';
      const enc = buildEncounter(j.seed + nodeId, tier, party, isBoss);
      setBattle(createBattle(j.seed + nodeId * 7, enc.board, enc.allies, enc.foes, inventory));
      setMode({ kind: 'idle' });
      setInspectId(null);
      setPhase('battle');
    } else if (kind === 'town') {
      sfx.coin();
      setPhase('town');
    } else if (kind === 'treasure') {
      const g = 30 + Math.floor(rand() * 25) + tier * 8;
      const itemId = rand() < 0.55 ? pick(rand, Object.keys(ITEMS)) : null;
      setGold((v) => v + g);
      if (itemId) setInventory((inv) => addItem(inv, itemId));
      setReward({ gold: g, exp: 0, item: itemId, heal: 0 });
      sfx.coin();
      setPhase('treasure');
    } else if (kind === 'camp') {
      const heal = 18 + tier * 3;
      setParty((p) => p.map((u) => ({ ...u, hp: Math.min(u.maxHp, u.hp + heal) })));
      setReward({ gold: 0, exp: 0, item: null, heal });
      sfx.heal();
      setPhase('camp');
    } else {
      setPhase('journey');
    }
  };

  // ── 전투: 적 차례는 자동으로 진행
  useEffect(() => {
    if (phase !== 'battle' || !battle || battle.result) return;
    const u = currentUnit(battle);
    if (!u) return;
    if (u.side !== 'foe') return;
    const t = setTimeout(() => {
      setBattle((s) => (s && !s.result && currentUnit(s)?.side === 'foe' ? foeAct(s) : s));
      sfx.hit();
    }, 550);
    return () => clearTimeout(t);
  }, [phase, battle]);

  // ── 전투 종료 → 결과 화면
  useEffect(() => {
    if (phase !== 'battle' || !battle?.result) return;
    const win = battle.result === 'win';
    const t = setTimeout(() => {
      if (win) sfx.win();
      else sfx.lose();
      // 전투 결과를 원정 상태로 반영 (체력·레벨·경험치·소지품)
      const survivors = battle.units.filter((u) => u.side === 'ally');
      setParty((p) =>
        p.map((u) => {
          const b = survivors.find((s) => s.id === u.id);
          if (!b) return u;
          return { ...u, hp: b.alive ? b.hp : 1, level: b.level, exp: b.exp, atk: b.atk, def: b.def, maxHp: b.maxHp, speed: b.speed };
        }),
      );
      setInventory(battle.items);
      const node = journey ? nodeById(journey, journey.currentId) : null;
      const isBoss = node?.kind === 'boss';
      const g = win ? battleGold(node?.col ?? 1, isBoss) : 0;
      if (win) setGold((v) => v + g);
      setReward({ gold: g, exp: battle.exp, item: null, heal: 0 });
      setPhase('result');
    }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, battle?.result]);

  const unit = battle ? currentUnit(battle) : null;
  const isAllyTurn = !!unit && unit.side === 'ally' && !battle?.result;

  // ── 하이라이트 (이동 파랑 / 대상 빨강)
  const highlights: Highlights = useMemo(() => {
    const empty: Highlights = { move: new Set(), target: new Set(), path: new Set() };
    if (!battle || !unit || !isAllyTurn) return empty;
    if (mode.kind === 'heal') {
      return { ...empty, target: new Set(healTargets(battle, unit).map((t) => key(t.x, t.y))) };
    }
    if (mode.kind === 'skill') {
      return { ...empty, target: new Set(skillTargets(battle, unit).map((t) => key(t.x, t.y))) };
    }
    if (mode.kind === 'item') {
      return {
        ...empty,
        target: new Set(itemTargets(battle, unit, mode.itemId).map((t) => key(t.x, t.y))),
      };
    }
    // idle — 따로 메뉴를 누르지 않아도 바로 움직이고 때릴 수 있으므로,
    //        갈 수 있는 칸(파랑)과 지금 때릴 수 있는 적(빨강)을 함께 보여 준다.
    const m = new Set<string>();
    if (!battle.moved) movesFor(battle, unit).forEach((t) => m.add(key(t.x, t.y)));
    const tg = new Set(attackTargets(battle, unit).map((t) => key(t.x, t.y)));
    return { ...empty, move: m, target: tg };
  }, [battle, unit, mode, isAllyTurn]);

  // ── 보드 클릭
  const onTile = useCallback(
    (x: number, y: number) => {
      if (!battle || battle.result) return;
      const u = currentUnit(battle);
      if (!u || u.side !== 'ally') return;
      const target = unitAt(battle.units, x, y);

      if (mode.kind === 'skill') {
        if (target && skillTargets(battle, u).some((t) => t.id === target.id)) {
          setBattle(doSkill(battle, target.id));
          setMode({ kind: 'idle' });
          setInspectId(null);
          sfx.hit();
        } else sfx.cancel();
        return;
      }
      if (mode.kind === 'heal' && target && target.side === u.side) {
        setBattle(doHeal(battle, target.id));
        setMode({ kind: 'idle' });
        sfx.heal();
        return;
      }
      if (mode.kind === 'item' && target) {
        const ok = itemTargets(battle, u, mode.itemId).some((t) => t.id === target.id);
        if (ok) {
          setBattle(doItem(battle, mode.itemId, target.id));
          setMode({ kind: 'idle' });
          sfx.item();
        } else sfx.cancel();
        return;
      }
      // ── idle — 메뉴를 거치지 않는 직접 조작이 기본이다.
      //    적을 누르면 곧장 공격, 파란 칸을 누르면 곧장 이동.
      if (target && target.side !== u.side) {
        if (attackTargets(battle, u).some((t) => t.id === target.id)) {
          setBattle(doAttack(battle, target.id));
          setInspectId(null);
          sfx.hit();
        } else {
          // 사거리 밖 — 때릴 수 없으니 정보만 보여 준다
          setInspectId(target.id);
          sfx.cancel();
        }
        return;
      }
      if (!target && !battle.moved && movesFor(battle, u).has(key(x, y))) {
        setBattle(doMove(battle, x, y));
        sfx.move();
        return;
      }
      // 그 외(아군·빈 칸 밖) — 정보 확인
      setInspectId(target ? target.id : null);
    },
    [battle, mode],
  );

  // 우클릭 — 행동하지 않고 상세 정보만 (오조작 없이 적을 살펴볼 수 있게)
  const onInspectTile = useCallback(
    (x: number, y: number) => {
      if (!battle) return;
      const target = unitAt(battle.units, x, y);
      setInspectId(target ? target.id : null);
      if (target) sfx.select();
    },
    [battle],
  );

  // ── 마을 행동
  const townHeal = () => {
    if (gold < HEAL_COST) return;
    setGold((v) => v - HEAL_COST);
    setParty((p) => p.map((u) => ({ ...u, hp: u.maxHp })));
    sfx.heal();
  };
  const townBuy = (itemId: string) => {
    const it = ITEMS[itemId];
    if (!it || gold < it.price) return;
    setGold((v) => v - it.price);
    setInventory((inv) => addItem(inv, itemId));
    sfx.coin();
  };
  // 영입 후보 — 지도·노드 시드로 결정 (같은 마을은 늘 같은 후보)
  const recruitOffer = useMemo<ClassId | null>(() => {
    if (!journey || phase !== 'town') return null;
    if (party.length >= PARTY_MAX) return null;
    const rand = mulberry32(journey.seed * 977 + journey.currentId * 13 + 5);
    return pick(rand, RECRUIT_POOL);
  }, [journey, phase, party.length]);
  const townRecruit = () => {
    if (!recruitOffer || gold < RECRUIT_COST || party.length >= PARTY_MAX) return;
    setGold((v) => v - RECRUIT_COST);
    const level = Math.max(1, Math.round(party.reduce((s, u) => s + u.level, 0) / party.length));
    setParty((p) => [...p, makeUnit(`ally-${Date.now()}`, recruitOffer, level, 0, 0)]);
    sfx.win();
  };

  // ── 결과 화면 진행
  const afterResult = () => {
    sfx.tap();
    if (battle?.result === 'lose') {
      setPhase('title');
      setBattle(null);
      return;
    }
    const node = journey ? nodeById(journey, journey.currentId) : null;
    setBattle(null);
    if (node?.kind === 'boss') setPhase('ending');
    else setPhase('journey');
  };

  const lastHover = useRef<[number, number] | null>(null); // 검증용 — 포인터가 어느 칸으로 읽혔나
  const onHoverTile = useCallback(
    (x: number, y: number | null) => {
      lastHover.current = y === null ? null : [x, y];
      if (!battle || y === null) return setHoverId(null);
      setHoverId(unitAt(battle.units, x, y)?.id ?? null);
    },
    [battle],
  );

  // 고정(우클릭)이 우선, 없으면 마우스가 올라간 말을 보여 준다 —
  // 덕분에 적 위에 커서만 올려도 예상 피해를 미리 볼 수 있다.
  const shownId = inspectId ?? hoverId;
  const inspectUnit = battle && shownId ? battle.units.find((u) => u.id === shownId) : null;

  // ── 개발 검증용 훅 (프로덕션 번들 제외) — 브라우저 자동화·밸런스 시뮬레이터의 진입점.
  //    3D 클릭을 흉내 내지 않고 tile(x,y)로 같은 경로를 태울 수 있다.
  const devRef = useRef({ battle, journey, party, gold, phase, onTile, travel });
  devRef.current = { battle, journey, party, gold, phase, onTile, travel };
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__bq = {
      phase: () => devRef.current.phase,
      state: () => devRef.current.battle,
      journey: () => devRef.current.journey,
      party: () => devRef.current.party,
      gold: () => devRef.current.gold,
      /** 보드 칸 클릭 (3D 레이캐스트와 동일 경로) */
      tile: (x: number, y: number) => devRef.current.onTile(x, y),
      /** 원정 지도에서 노드로 이동 */
      travel: (id: number) => devRef.current.travel(id),
      /** 포인터가 마지막으로 읽힌 칸 — 레이캐스트 정확도 검증용 */
      hover: () => lastHover.current,
    };
  }, []);

  return (
    <div className="app">
      {phase === 'battle' && battle && (
        <>
          <Canvas
            className="canvas"
            camera={{ fov: 50, position: [0, 18, 13] }}
            dpr={[1, 2]}
            onContextMenu={(e) => e.preventDefault()} // 우클릭은 '정보 보기'로 쓴다
          >
            <color attach="background" args={['#131a26']} />
            <BattleScene
              state={battle}
              highlights={highlights}
              onTile={onTile}
              onInspect={onInspectTile}
              onHover={onHoverTile}
            />
          </Canvas>

          <div className="battle-ui">
            <div className="battle-top">
              <TurnOrderBar state={battle} />
              <button className="chip mute-btn" onClick={toggleMute}>
                {muted ? '🔇' : '🔊'}
              </button>
            </div>

            <div className="battle-side">
              {unit && <UnitCard unit={unit} state={battle} />}
              {inspectUnit && unit && inspectUnit.id !== unit.id && (
                <>
                  <UnitCard unit={inspectUnit} state={battle} />
                  {inspectUnit.side !== unit.side && (
                    <TargetPreview
                      state={battle}
                      attacker={unit}
                      target={inspectUnit}
                      skill={mode.kind === 'skill' ? skillOf(unit) : null}
                    />
                  )}
                </>
              )}
              <BattleLog log={battle.log} />
            </div>

            <div className="battle-bottom">
              {isAllyTurn && unit ? (
                <ActionMenu
                  state={battle}
                  unit={unit}
                  mode={mode}
                  canHeal={unit.cls === 'staff' && healTargets(battle, unit).length > 0}
                  canSkill={canUseSkill(battle, unit)}
                  items={battle.items}
                  onSkill={() => {
                    // 대상을 고를 필요가 없는 특기(회전베기·기도)는 바로 발동한다
                    const def = skillOf(unit);
                    sfx.select();
                    if (def && def.target === 'self') {
                      setBattle(doSkill(battle, null));
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
                    setBattle(doWait(battle));
                    setMode({ kind: 'idle' });
                  }}
                  onUndo={() => {
                    sfx.cancel();
                    setBattle(undoMove(battle));
                  }}
                  onCancel={() => {
                    sfx.cancel();
                    setMode({ kind: 'idle' });
                  }}
                />
              ) : (
                <p className="waiting">
                  {battle.result ? '전투 종료…' : `${unit?.name ?? '적'}의 차례…`}
                </p>
              )}
            </div>
          </div>
        </>
      )}

      {phase === 'title' && (
        <TitleScreen best={best} muted={muted} onStart={startRun} onToggleMute={toggleMute} />
      )}

      {phase === 'journey' && journey && (
        <JourneyScreen journey={journey} party={party} gold={gold} onTravel={travel} />
      )}

      {phase === 'town' && (
        <TownScreen
          party={party}
          gold={gold}
          inventory={inventory}
          recruitOffer={recruitOffer}
          onHeal={townHeal}
          onBuy={townBuy}
          onRecruit={townRecruit}
          onLeave={() => {
            sfx.march();
            setPhase('journey');
          }}
        />
      )}

      {phase === 'treasure' && (
        <TreasureScreen gold={reward.gold} itemId={reward.item} onContinue={() => {
          sfx.tap();
          setPhase('journey');
        }} />
      )}

      {phase === 'camp' && (
        <CampScreen
          healed={reward.heal}
          party={party}
          onContinue={() => {
            sfx.tap();
            setPhase('journey');
          }}
        />
      )}

      {phase === 'result' && battle && (
        <BattleResultScreen
          win={battle.result === 'win'}
          gold={reward.gold}
          exp={reward.exp}
          party={party}
          onContinue={afterResult}
        />
      )}

      {phase === 'ending' && journey && (
        <EndingScreen cols={journey.cols} onRestart={startRun} />
      )}

      {/* 원정대 상태 — 전투 밖에서 항상 확인 */}
      {phase !== 'title' && phase !== 'battle' && party.length > 0 && (
        <div className="party-footer">
          {party.map((u) => (
            <span key={u.id} className="chip">
              {CLASSES[u.cls].icon} {u.name} Lv.{u.level} · {u.hp}/{u.maxHp}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
