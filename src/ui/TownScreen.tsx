import { ITEMS, type Inventory } from '../lib/items';
import { CLASSES, type ClassId, type Unit } from '../lib/units';
import { ChoiceList } from './Menu';

// 마을 — 정비 지점. 회복·물자 구입·동료 영입 후 다시 길을 떠난다.
export const HEAL_COST = 30;
export const RECRUIT_COST = 90;
export const PARTY_MAX = 4;

export default function TownScreen({
  party,
  gold,
  inventory,
  recruitOffer,
  onHeal,
  onBuy,
  onRecruit,
  onLeave,
}: {
  party: Unit[];
  gold: number;
  inventory: Inventory;
  recruitOffer: ClassId | null;
  onHeal: () => void;
  onBuy: (itemId: string) => void;
  onRecruit: () => void;
  onLeave: () => void;
}) {
  const hurt = party.some((u) => u.hp < u.maxHp);
  const recruitDef = recruitOffer ? CLASSES[recruitOffer] : null;

  const items = [
    {
      key: 'heal',
      label: `🍲 여관에서 쉰다 — 전원 완전 회복 (🪙 ${HEAL_COST})`,
      disabled: gold < HEAL_COST || !hurt,
      onPick: onHeal,
    },
    ...Object.values(ITEMS).map((it) => ({
      key: `buy-${it.id}`,
      label: `${it.icon} ${it.name} 구입 — ${it.desc} (🪙 ${it.price})`,
      disabled: gold < it.price,
      onPick: () => onBuy(it.id),
    })),
  ];
  if (recruitDef) {
    items.push({
      key: 'recruit',
      label: `${recruitDef.icon} ${recruitDef.name} 영입 — ${recruitDef.desc} (🪙 ${RECRUIT_COST})`,
      disabled: gold < RECRUIT_COST || party.length >= PARTY_MAX,
      onPick: onRecruit,
    });
  }
  items.push({ key: 'leave', label: '🚪 길을 떠난다', disabled: false, onPick: onLeave });

  return (
    <div className="screen town-screen">
      <h2>🏘️ 마을</h2>
      <p className="hint">
        불빛이 새어 나오는 작은 마을이다. 여기서 정비하고 다시 길을 떠날 수 있다.
      </p>
      <div className="town-status">
        <span className="chip">🪙 {gold}</span>
        {party.map((u) => (
          <span key={u.id} className="chip">
            {CLASSES[u.cls].icon} {u.hp}/{u.maxHp}
          </span>
        ))}
        {Object.entries(inventory).map(([id, n]) =>
          ITEMS[id] ? (
            <span key={id} className="chip">
              {ITEMS[id].icon} ×{n}
            </span>
          ) : null,
        )}
      </div>
      <ChoiceList items={items} />
    </div>
  );
}
