import { TERRAIN, terrainAt } from '../lib/board';
import { previewDamage, skillOf, type BattleState } from '../lib/battle';
import { ITEMS, type Inventory } from '../lib/items';
import { skillRange, type SkillDef } from '../lib/skills';
import { CLASSES, type Unit } from '../lib/units';
import { ChoiceList } from './Menu';

// 전투 화면의 DOM 오버레이 — 차례 순서·현재 유닛 정보·행동 메뉴·기록.
// 보드(3D)는 BattleScene이, 판단에 필요한 정보는 전부 여기가 보여 준다.

// 이동·공격은 판을 직접 눌러서 하므로 모드가 없다.
// 대상을 고르는 회복·아이템만 잠깐 모드로 들어간다.
export type BattleMode =
  | { kind: 'idle' }
  | { kind: 'heal' }
  | { kind: 'skill' } // 대상을 골라야 하는 특기 (저격·관통)
  | { kind: 'item'; itemId: string };

export function TurnOrderBar({ state }: { state: BattleState }) {
  const upcoming = state.order
    .map((id) => state.units.find((u) => u.id === id))
    .filter((u): u is Unit => !!u && u.alive);
  return (
    <div className="turn-bar">
      <span className="turn-round">R{state.round}</span>
      {upcoming.map((u, i) => {
        const isNow = state.order[state.turnIdx] === u.id;
        return (
          <span
            key={u.id + i}
            className={`turn-chip ${u.side}${isNow ? ' now' : ''}${u.acted ? ' done' : ''}`}
            title={`${u.name} (속도 ${u.speed})`}
          >
            {CLASSES[u.cls].icon}
          </span>
        );
      })}
    </div>
  );
}

export function UnitCard({ unit, state }: { unit: Unit; state: BattleState }) {
  const c = CLASSES[unit.cls];
  const t = TERRAIN[terrainAt(state.board, unit.x, unit.y)];
  const ratio = Math.max(0, unit.hp / unit.maxHp);
  return (
    <div className={`unit-card ${unit.side}`}>
      <div className="unit-head">
        <span className="unit-icon">{c.icon}</span>
        <span className="unit-name">
          {unit.name} <em>Lv.{unit.level}</em>
        </span>
      </div>
      <div className="hp-wrap">
        <div className="hp-bar" style={{ width: `${ratio * 100}%` }} />
        <span className="hp-text">
          {unit.hp} / {unit.maxHp}
        </span>
      </div>
      <div className="unit-stats">
        <span>⚔️ {unit.atk + unit.buffAtk}</span>
        <span>🛡️ {unit.def}</span>
        <span>👣 {unit.move}</span>
        <span>🎯 {unit.range}</span>
        <span className="terr">
          {t.name}
          {t.def > 0 && ` 방+${t.def}`}
          {t.atk > 0 && ` 공+${t.atk}`}
        </span>
      </div>
      {skillOf(unit) && (
        <div className={`unit-skill${unit.cd > 0 ? ' cooling' : ''}`}>
          {skillOf(unit)!.icon} {skillOf(unit)!.name}
          <em>{unit.cd > 0 ? ` ${unit.cd}라운드 뒤` : ' 준비됨'}</em>
        </div>
      )}
    </div>
  );
}

// 행동 메뉴 — 현재 아군 유닛이 할 수 있는 것들
export function ActionMenu({
  state,
  unit,
  mode,
  canHeal,
  canSkill,
  items,
  onHeal,
  onSkill,
  onItem,
  onWait,
  onUndo,
  onCancel,
}: {
  state: BattleState;
  unit: Unit;
  mode: BattleMode;
  canHeal: boolean;
  canSkill: boolean;
  items: Inventory;
  onHeal: () => void;
  onSkill: () => void;
  onItem: (id: string) => void;
  onWait: () => void;
  onUndo: () => void;
  onCancel: () => void;
}) {
  const skill = skillOf(unit);

  if (mode.kind !== 'idle') {
    const hint =
      mode.kind === 'heal'
        ? '아군을 눌러 회복'
        : mode.kind === 'skill'
          ? `${skill?.icon ?? ''} ${skill?.name ?? ''} — 붉은 적을 누르세요`
          : `${ITEMS[mode.itemId]?.icon ?? ''} 대상을 누르세요`;
    return (
      <div className="action-panel">
        <p className="action-hint">{hint}</p>
        <ChoiceList items={[{ key: 'cancel', label: '↩️ 취소', onPick: onCancel }]} />
      </div>
    );
  }

  // 이동·공격은 판을 직접 누르는 게 기본이라 메뉴에 없다.
  // 여기 남는 건 '판을 눌러선 뜻이 애매한' 것들뿐.
  const ownedItems = Object.keys(items).filter((id) => (items[id] ?? 0) > 0 && ITEMS[id]);
  const menu: { key: string; label: string; disabled: boolean; onPick: () => void }[] = [];

  // 특기 — 쿨다운이 남았으면 남은 라운드를 그대로 보여 준다 (언제 다시 쓸지가 판단의 재료)
  if (skill) {
    menu.push({
      key: 'skill',
      label:
        unit.cd > 0
          ? `${skill.icon} ${skill.name} (${unit.cd}라운드 뒤)`
          : `${skill.icon} ${skill.name}`,
      disabled: !canSkill,
      onPick: onSkill,
    });
  }
  if (unit.cls === 'staff') {
    menu.push({ key: 'heal', label: '✨ 회복', disabled: !canHeal, onPick: onHeal });
  }
  for (const id of ownedItems) {
    const it = ITEMS[id];
    menu.push({
      key: `item-${id}`,
      label: `${it.icon} ${it.name} ×${items[id]}`,
      disabled: false,
      onPick: () => onItem(id),
    });
  }
  if (state.moved) {
    menu.push({ key: 'undo', label: '↩️ 이동 취소', disabled: false, onPick: onUndo });
  }
  menu.push({ key: 'wait', label: '💤 대기 (턴 종료)', disabled: false, onPick: onWait });

  return (
    <div className="action-panel">
      <p className="action-hint dim">
        {state.moved ? '' : '🔵 칸 = 이동 · '}🔴 적 = 공격 · 우클릭(길게 누르기) = 정보
      </p>
      <ChoiceList items={menu} />
    </div>
  );
}

// 표적 미리보기 — 이 적을 때리면 얼마나 아프고, 반격은 얼마나 오는지
export function TargetPreview({
  state,
  attacker,
  target,
  skill,
}: {
  state: BattleState;
  attacker: Unit;
  target: Unit;
  /** 특기를 겨누는 중이면 그 배수·반격 규칙으로 미리 본다 */
  skill?: SkillDef | null;
}) {
  const d = Math.abs(attacker.x - target.x) + Math.abs(attacker.y - target.y);
  const reaches = skill ? d <= skillRange(skill, attacker.range) : d <= attacker.range;
  const dmg = previewDamage(state.board, attacker, target, skill?.dmgMul ?? 1);
  const counter = previewDamage(state.board, target, attacker);
  const counters = !skill?.noCounter && d <= target.range;
  return (
    <div className="target-preview">
      <span className="tp-name">
        {skill ? `${skill.icon} ` : ''}
        {CLASSES[target.cls].icon} {target.name}
      </span>
      {reaches ? (
        <>
          <span className="tp-dmg">
            예상 피해 {dmg.min}~{dmg.max}
            {dmg.min >= target.hp && <em> · 처치!</em>}
          </span>
          <span className="tp-counter">
            {counters
              ? `반격 ${Math.round(counter.min * 0.6)}~${Math.round(counter.max * 0.6)}`
              : '반격 없음'}
          </span>
        </>
      ) : (
        <span className="tp-counter">사거리 밖 (거리 {d})</span>
      )}
    </div>
  );
}

export function BattleLog({ log }: { log: string[] }) {
  return (
    <div className="battle-log">
      {log.slice(-4).map((line, i) => (
        <p key={`${i}-${line}`}>{line}</p>
      ))}
    </div>
  );
}
