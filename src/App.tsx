import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createBattle, sideItems, type BattleState } from './lib/battle';
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
import BattleView from './ui/BattleView';
import JourneyScreen from './ui/JourneyScreen';
import { HEAL_COST, PARTY_MAX, RECRUIT_COST, START_GOLD } from './lib/economy';
import TownScreen from './ui/TownScreen';
import VersusGame from './VersusGame';
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
const RECRUIT_POOL: ClassId[] = ['spear', 'sword', 'bow', 'staff'];

export default function App() {
  const [phase, setPhase] = useState<Phase>('title');
  const [journey, setJourney] = useState<Journey | null>(null);
  const [party, setParty] = useState<Unit[]>([]);
  const [gold, setGold] = useState(START_GOLD);
  const [inventory, setInventory] = useState<Inventory>({ potion: 2 });
  const [battle, setBattle] = useState<BattleState | null>(null);
  const [versus, setVersus] = useState(false); // 2인 대전 모드 (VersusGame이 통째로 맡는다)
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
      setBattle(createBattle(j.seed + nodeId * 7, enc.board, enc.allies, enc.foes, sideItems(inventory)));
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
      setInventory(battle.items.ally);
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

  // 1인 원정에서는 아군만 사람이 조작한다 (적은 BattleView 안에서 봇이 둔다)
  const canControl = useCallback((u: Unit) => u.side === 'ally', []);

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

  // 검증용 — 보드 클릭과 '포인터가 어느 칸으로 읽혔나'를 BattleView에서 받아 둔다
  const lastHover = useRef<[number, number] | null>(null);
  const tileRef = useRef<(x: number, y: number) => void>(() => {});

  // ── 개발 검증용 훅 (프로덕션 번들 제외) — 브라우저 자동화·밸런스 시뮬레이터의 진입점.
  //    3D 클릭을 흉내 내지 않고 tile(x,y)로 같은 경로를 태울 수 있다.
  const devRef = useRef({ battle, journey, party, gold, phase, travel });
  devRef.current = { battle, journey, party, gold, phase, travel };
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    // 밸런스 시뮬레이터 — 콘솔에서 __bqsim.sweep()
    void import('./dev/simBot').then((m) => m.installSimHook());
    (window as unknown as Record<string, unknown>).__bq = {
      phase: () => devRef.current.phase,
      state: () => devRef.current.battle,
      journey: () => devRef.current.journey,
      party: () => devRef.current.party,
      gold: () => devRef.current.gold,
      /** 보드 칸 클릭 (3D 레이캐스트와 동일 경로) */
      tile: (x: number, y: number) => tileRef.current(x, y),
      /** 원정 지도에서 노드로 이동 */
      travel: (id: number) => devRef.current.travel(id),
      /** 포인터가 마지막으로 읽힌 칸 — 레이캐스트 정확도 검증용 */
      hover: () => lastHover.current,
    };
  }, []);

  if (versus) {
    return (
      <div className="app">
        <VersusGame muted={muted} onToggleMute={toggleMute} onExit={() => setVersus(false)} />
      </div>
    );
  }

  return (
    <div className="app">
      {phase === 'battle' && battle && (
        <BattleView
          state={battle}
          setState={setBattle as (s: BattleState | ((p: BattleState) => BattleState)) => void}
          canControl={canControl}
          muted={muted}
          onToggleMute={toggleMute}
          tileRef={tileRef}
          hoverRef={lastHover}
        />
      )}

      {phase === 'title' && (
        <TitleScreen
          best={best}
          muted={muted}
          onStart={startRun}
          onVersus={() => {
            sfx.march();
            setVersus(true);
          }}
          onToggleMute={toggleMute}
        />
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
