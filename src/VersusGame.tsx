import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createBattle, sideItems, type BattleState } from './lib/battle';
import { battleGold, buildEncounter, buildVersusEncounter } from './lib/encounter';
import { addItem, ITEMS } from './lib/items';
import type { NodeKind } from './lib/journey';
import { HEAL_COST, PARTY_MAX, RECRUIT_COST, START_GOLD } from './lib/economy';
import { mulberry32, pick } from './lib/rng';
import { sfx } from './lib/sound';
import { CLASSES, makeUnit, type ClassId, type Unit } from './lib/units';
import {
  campCol,
  choicesFor,
  createVersus,
  moveCamp,
  nodeOf,
  other,
  passTurn,
  PLAYERS,
  tierFor,
  type PlayerId,
  type VersusState,
} from './lib/versus';
import AssignScreen from './ui/AssignScreen';
import BattleView from './ui/BattleView';
import JourneyScreen from './ui/JourneyScreen';
import { CampScreen, TreasureScreen } from './ui/Screens';
import TownScreen from './ui/TownScreen';
import { PrimaryButton } from './ui/Menu';

// 2인 대전 원정 — 규칙과 상태 전이는 lib/versus.ts, 여기서는 화면 배선만 한다.
// 흐름: journey(번갈아 길 선택) → 노드별 화면 → 다시 journey …
//        → 같은 단계에서 조우 → 대전(PvP) → over
type VPhase = 'journey' | 'assign' | 'battle' | 'result' | 'town' | 'treasure' | 'camp' | 'over';

const START_PARTY: ClassId[] = ['sword', 'bow', 'staff'];
const RECRUIT_POOL: ClassId[] = ['spear', 'sword', 'bow', 'staff'];

const makeCamp = (who: PlayerId) => ({
  party: START_PARTY.map((cls, i) => makeUnit(`${who}-${i}`, cls, 1, 0, 0)),
  gold: START_GOLD,
  inventory: { potion: 2 },
});

export default function VersusGame({
  muted,
  onToggleMute,
  onExit,
}: {
  muted: boolean;
  onToggleMute: () => void;
  onExit: () => void;
}) {
  const [v, setV] = useState<VersusState>(() =>
    createVersus(Math.floor(Math.random() * 100000), makeCamp('p1'), makeCamp('p2')),
  );
  const [phase, setPhase] = useState<VPhase>('journey');
  const [battle, setBattle] = useState<BattleState | null>(null);
  const [pending, setPending] = useState<BattleState | null>(null); // 배정 화면이 붙들고 있는 전투
  const [isPvp, setIsPvp] = useState(false);
  const [actor, setActor] = useState<PlayerId>('p1'); // 이 노드/전투의 주인 (성장 전투용)
  const [autoIds, setAutoIds] = useState<Set<string>>(new Set());
  const [reward, setReward] = useState({ gold: 0, exp: 0, item: null as string | null, heal: 0 });
  const [winner, setWinner] = useState<PlayerId | null>(null);

  const camp = v.camps[actor];
  const turnCamp = v.camps[v.turn];

  const patchCamp = (who: PlayerId, patch: Partial<(typeof v.camps)[PlayerId]>) =>
    setV((s) => ({ ...s, camps: { ...s.camps, [who]: { ...s.camps[who], ...patch } } }));

  // ── 길 이동 → 조우거나, 노드 종류에 따른 화면
  const onTravel = (nodeId: number) => {
    if (phase !== 'journey') return;
    const who = v.turn;
    const r = moveCamp(v, who, nodeId);
    if (!r) return;
    setV(r.state);
    setActor(who);
    if (r.met) {
      sfx.turn();
      openPvp(r.state);
      return;
    }
    sfx.march();
    resolveNode(r.state, who, nodeId, r.kind);
  };

  const resolveNode = (
    s: VersusState,
    who: PlayerId,
    nodeId: number,
    kind: NodeKind,
  ) => {
    const node = nodeOf(s.journey, nodeId);
    const tier = tierFor(s.journey, who, node.col);
    const rand = mulberry32(s.journey.seed * 31 + nodeId * 17 + 3);
    const c = s.camps[who];
    if (kind === 'battle' || kind === 'boss') {
      sfx.turn();
      const enc = buildEncounter(s.journey.seed + nodeId, tier, c.party, false);
      setPending(
        createBattle(
          s.journey.seed + nodeId * 7,
          enc.board,
          enc.allies,
          enc.foes,
          sideItems(c.inventory),
        ),
      );
      setIsPvp(false);
      setPhase('assign');
    } else if (kind === 'town') {
      sfx.coin();
      setPhase('town');
    } else if (kind === 'treasure') {
      const g = 30 + Math.floor(rand() * 25) + tier * 8;
      const itemId = rand() < 0.55 ? pick(rand, Object.keys(ITEMS)) : null;
      patchCamp(who, {
        gold: c.gold + g,
        inventory: itemId ? addItem(c.inventory, itemId) : c.inventory,
      });
      setReward({ gold: g, exp: 0, item: itemId, heal: 0 });
      sfx.coin();
      setPhase('treasure');
    } else if (kind === 'camp') {
      const heal = 18 + tier * 3;
      patchCamp(who, {
        party: c.party.map((u) => ({ ...u, hp: Math.min(u.maxHp, u.hp + heal) })),
      });
      setReward({ gold: 0, exp: 0, item: null, heal });
      sfx.heal();
      setPhase('camp');
    } else {
      nextTurn();
    }
  };

  // ── 조우 → 대전 판을 세운다 (2P 진영은 엔진상 foe 쪽에 앉는다)
  const openPvp = (s: VersusState) => {
    const enc = buildVersusEncounter(
      s.journey.seed + 4321,
      s.camps.p1.party,
      s.camps.p2.party,
    );
    setPending(
      createBattle(s.journey.seed + 99, enc.board, enc.allies, enc.foes, {
        ally: s.camps.p1.inventory,
        foe: s.camps.p2.inventory,
      }),
    );
    setIsPvp(true);
    setPhase('assign');
  };

  const nextTurn = () => {
    setV((s) => passTurn(s));
    setPhase('journey');
  };

  // ── 전투 종료 처리
  useEffect(() => {
    if (phase !== 'battle' || !battle?.result) return;
    const t = setTimeout(() => {
      if (isPvp) {
        const w: PlayerId = battle.result === 'win' ? 'p1' : 'p2';
        setWinner(w);
        sfx.win();
        setPhase('over');
        return;
      }
      // 성장 전투 — 체력·레벨·소지품을 그 진영에 반영한다.
      // 져도 원정에서 탈락시키지는 않는다 (전원 체력 1로 물러날 뿐) — 승부는 대전에서 갈린다.
      const win = battle.result === 'win';
      if (win) sfx.win();
      else sfx.lose();
      const survivors = battle.units.filter((u) => u.side === 'ally');
      const node = nodeOf(v.journey, v.camps[actor].nodeId);
      const g = win ? battleGold(tierFor(v.journey, actor, node.col), false) : 0;
      patchCamp(actor, {
        party: v.camps[actor].party.map((u) => {
          const b = survivors.find((s) => s.id === u.id);
          if (!b) return u;
          return {
            ...u,
            hp: b.alive ? Math.max(1, b.hp) : 1,
            level: b.level,
            exp: b.exp,
            atk: b.atk,
            def: b.def,
            maxHp: b.maxHp,
            speed: b.speed,
          };
        }),
        inventory: battle.items.ally,
        gold: v.camps[actor].gold + g,
      });
      setReward({ gold: g, exp: battle.exp, item: null, heal: 0 });
      setPhase('result');
    }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, battle?.result]);

  // ── 담당 배정
  const toggleAuto = (unitId: string) =>
    setAutoIds((s) => {
      const n = new Set(s);
      if (n.has(unitId)) n.delete(unitId);
      else n.add(unitId);
      return n;
    });
  const setAll = (who: PlayerId, auto: boolean) =>
    setAutoIds((s) => {
      const n = new Set(s);
      for (const u of v.camps[who].party) {
        if (auto) n.add(u.id);
        else n.delete(u.id);
      }
      return n;
    });

  // 이 말을 사람이 조작하는가 — 적(컴퓨터)이거나 자동으로 맡긴 말이면 봇이 둔다
  const canControl = useCallback(
    (u: Unit) => {
      if (!isPvp && u.side !== 'ally') return false; // 성장 전투의 적은 늘 컴퓨터
      return !autoIds.has(u.id);
    },
    [isPvp, autoIds],
  );
  const ownerOf = useCallback(
    (u: Unit): PlayerId | null => {
      if (isPvp) return u.side === 'ally' ? 'p1' : 'p2';
      return u.side === 'ally' ? actor : null;
    },
    [isPvp, actor],
  );
  const turnLabel = useCallback(
    (u: Unit) => {
      const owner = ownerOf(u);
      if (!owner) return '👹 적의 차례';
      const p = PLAYERS[owner];
      return `${p.icon} ${p.name} 차례 — ${CLASSES[u.cls].icon} ${u.name}${
        autoIds.has(u.id) ? ' (🤖 자동)' : ''
      }`;
    },
    [ownerOf, autoIds],
  );

  // ── 마을
  const recruitOffer = useMemo<ClassId | null>(() => {
    if (phase !== 'town') return null;
    if (camp.party.length >= PARTY_MAX) return null;
    const rand = mulberry32(v.journey.seed * 977 + camp.nodeId * 13 + 5);
    return pick(rand, RECRUIT_POOL);
  }, [phase, v.journey.seed, camp.nodeId, camp.party.length]);

  // ── 개발 검증용 훅 (프로덕션 제외) — 1인 원정의 __bq와 짝을 이루는 대전판 진입점.
  //    대전은 상태가 두 진영으로 갈려 있어, 자동 검증도 여기서만 볼 수 있는 게 많다.
  const tileRef = useRef<(x: number, y: number) => void>(() => {});
  const devRef = useRef({ v, phase, battle, isPvp, autoIds, onTravel });
  devRef.current = { v, phase, battle, isPvp, autoIds, onTravel };
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__bqv = {
      phase: () => devRef.current.phase,
      /** 대전 원정 상태 (두 진영·지도·차례) */
      versus: () => devRef.current.v,
      /** 지금 전투 상태 (성장 전투든 대전이든) */
      state: () => devRef.current.battle,
      pvp: () => devRef.current.isPvp,
      auto: () => [...devRef.current.autoIds],
      travel: (id: number) => devRef.current.onTravel(id),
      /** 보드 칸 클릭 (3D 레이캐스트와 동일 경로) */
      tile: (x: number, y: number) => tileRef.current(x, y),
    };
  }, []);

  const journeyMarkers = [
    { nodeId: v.camps.p1.nodeId, icon: PLAYERS.p1.icon, cls: 'p1' },
    { nodeId: v.camps.p2.nodeId, icon: PLAYERS.p2.icon, cls: 'p2' },
  ];
  const gap = campCol(v, 'p2') - campCol(v, 'p1');

  if (phase === 'journey') {
    const p = PLAYERS[v.turn];
    return (
      <JourneyScreen
        journey={v.journey}
        party={turnCamp.party}
        gold={turnCamp.gold}
        onTravel={onTravel}
        activeId={turnCamp.nodeId}
        choiceIds={choicesFor(v, v.turn).map((n) => n.id)}
        markers={journeyMarkers}
        headline={`${p.icon} ${p.name} 차례 — 길을 고르세요 · 조우까지 ${Math.max(0, gap)}걸음`}
        topExtra={
          <span className={`chip turn-chip-${v.turn}`}>
            {p.icon} {p.name} 차례
          </span>
        }
      />
    );
  }

  if (phase === 'assign' && pending) {
    const groups = isPvp
      ? ([
          { player: 'p1' as PlayerId, units: pending.units.filter((u) => u.side === 'ally') },
          { player: 'p2' as PlayerId, units: pending.units.filter((u) => u.side === 'foe') },
        ])
      : [{ player: actor, units: pending.units.filter((u) => u.side === 'ally') }];
    return (
      <AssignScreen
        title={isPvp ? '⚔️ 두 원정대가 마주쳤다!' : `${PLAYERS[actor].icon} ${PLAYERS[actor].name} 전투`}
        hint={
          isPvp
            ? '여기서 승부가 갈린다. 각 말을 누가 둘지 정하세요 (누르면 사람 ↔ 자동).'
            : '이 전투를 누가 둘지 정하세요 (누르면 사람 ↔ 자동).'
        }
        groups={groups}
        autoIds={autoIds}
        onToggle={toggleAuto}
        onAll={setAll}
        onStart={() => {
          sfx.turn();
          setBattle(pending);
          setPending(null);
          setPhase('battle');
        }}
      />
    );
  }

  if (phase === 'battle' && battle) {
    return (
      <BattleView
        state={battle}
        setState={setBattle as (s: BattleState | ((p: BattleState) => BattleState)) => void}
        canControl={canControl}
        turnLabel={turnLabel}
        muted={muted}
        onToggleMute={onToggleMute}
        tileRef={tileRef}
      />
    );
  }

  if (phase === 'town') {
    return (
      <TownScreen
        party={camp.party}
        gold={camp.gold}
        inventory={camp.inventory}
        recruitOffer={recruitOffer}
        onHeal={() => {
          if (camp.gold < HEAL_COST) return;
          patchCamp(actor, {
            gold: camp.gold - HEAL_COST,
            party: camp.party.map((u) => ({ ...u, hp: u.maxHp })),
          });
          sfx.heal();
        }}
        onBuy={(itemId) => {
          const it = ITEMS[itemId];
          if (!it || camp.gold < it.price) return;
          patchCamp(actor, {
            gold: camp.gold - it.price,
            inventory: addItem(camp.inventory, itemId),
          });
          sfx.coin();
        }}
        onRecruit={() => {
          if (!recruitOffer || camp.gold < RECRUIT_COST || camp.party.length >= PARTY_MAX) return;
          const level = Math.max(
            1,
            Math.round(camp.party.reduce((s, u) => s + u.level, 0) / camp.party.length),
          );
          patchCamp(actor, {
            gold: camp.gold - RECRUIT_COST,
            party: [
              ...camp.party,
              makeUnit(`${actor}-${camp.party.length}-${Date.now()}`, recruitOffer, level, 0, 0),
            ],
          });
          sfx.win();
        }}
        onLeave={() => {
          sfx.march();
          nextTurn();
        }}
      />
    );
  }

  if (phase === 'treasure') {
    return (
      <TreasureScreen
        gold={reward.gold}
        itemId={reward.item}
        onContinue={() => {
          sfx.tap();
          nextTurn();
        }}
      />
    );
  }

  if (phase === 'camp') {
    return (
      <CampScreen
        healed={reward.heal}
        party={camp.party}
        onContinue={() => {
          sfx.tap();
          nextTurn();
        }}
      />
    );
  }

  if (phase === 'result' && battle) {
    const win = battle.result === 'win';
    return (
      <div className="screen result-screen">
        <h2>
          {PLAYERS[actor].icon} {PLAYERS[actor].name} — {win ? '🏆 승리!' : '💀 후퇴…'}
        </h2>
        <p className="hint">
          {win
            ? `전리품 🪙 ${reward.gold} · 경험치 ${reward.exp}`
            : '밀렸다. 원정대는 체력 1로 물러난다 — 승부는 대전에서 갈린다.'}
        </p>
        <div className="town-status">
          {camp.party.map((u) => (
            <span key={u.id} className="chip">
              {CLASSES[u.cls].icon} Lv.{u.level} {u.hp}/{u.maxHp}
            </span>
          ))}
        </div>
        <PrimaryButton
          onPick={() => {
            sfx.tap();
            setBattle(null);
            nextTurn();
          }}
        >
          길을 계속 간다
        </PrimaryButton>
      </div>
    );
  }

  if (phase === 'over' && winner) {
    const w = PLAYERS[winner];
    const l = PLAYERS[other(winner)];
    return (
      <div className="screen result-screen ending">
        <h1>
          {w.icon} {w.name} 승리!
        </h1>
        <p className="hint">
          두 원정대가 들판에서 마주쳤고, {w.name}의 말들이 판 위에 남았다.
          <br />
          {l.name}, 다음 판은 또 다른 지도 — 다시 겨뤄 볼까요?
        </p>
        <PrimaryButton onPick={onExit}>처음으로</PrimaryButton>
      </div>
    );
  }

  return null;
}
