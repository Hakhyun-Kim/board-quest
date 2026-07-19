// 직업별 특기 — 순수 데이터. 판정은 battle.ts의 doSkill이 한다.
//
// 왜 MP가 아니라 쿨다운인가:
//  · 자원 관리 UI(마나 바·회복 수단)를 새로 들이지 않아도 된다.
//  · "지금 쓸까, 아껴 둘까"라는 판단이 라운드 단위로 또렷하게 생긴다.
//  · 시뮬레이터로 재기 쉽다 — 스킬 사용 빈도가 쿨다운으로 정해지므로.

export type SkillId = 'cleave' | 'snipe' | 'prayer' | 'pierce';

export interface SkillDef {
  id: SkillId;
  name: string;
  icon: string;
  desc: string;
  /** 쓰고 난 뒤 다시 쓸 수 있을 때까지의 라운드 수 */
  cooldown: number;
  /** 'self' = 대상을 고르지 않고 즉시 발동 (자기 주변에 작용) */
  target: 'foe' | 'self';
  /** 유닛 기본 사거리에 더할 값 (저격처럼 더 멀리 닿는 스킬용) */
  rangeBonus?: number;
  /** 기본 공격 대비 피해 배수 */
  dmgMul?: number;
  /** 반격을 받지 않는가 */
  noCounter?: boolean;
  /** 범위 방식 — adjacent: 자신의 인접 4칸 / pierce: 대상과 그 너머 한 칸 */
  area?: 'adjacent' | 'pierce';
  /** 사거리 안 아군 전체를 회복 (사제) — 기본 회복량 대비 배수 */
  healMul?: number;
}

export const SKILLS: Record<SkillId, SkillDef> = {
  cleave: {
    id: 'cleave',
    name: '회전베기',
    icon: '🌀',
    desc: '인접한 적 전부를 벤다 (피해 80%, 반격 없음).',
    cooldown: 3,
    target: 'self',
    area: 'adjacent',
    dmgMul: 0.8,
    noCounter: true,
  },
  snipe: {
    id: 'snipe',
    name: '저격',
    icon: '🎯',
    desc: '사거리 +2로 한 명을 정확히 쏜다 (피해 150%, 반격 없음).',
    cooldown: 3,
    target: 'foe',
    rangeBonus: 2,
    dmgMul: 1.5,
    noCounter: true,
  },
  prayer: {
    id: 'prayer',
    name: '기도',
    icon: '🙏',
    desc: '사거리 안의 아군 전부를 회복한다 (회복량 70%).',
    cooldown: 4,
    target: 'self',
    healMul: 0.7,
  },
  pierce: {
    id: 'pierce',
    name: '관통',
    icon: '🔱',
    desc: '적과 그 뒤에 선 적까지 한 번에 꿰뚫는다.',
    cooldown: 3,
    target: 'foe',
    dmgMul: 1,
    area: 'pierce',
  },
};

/** 스킬의 실제 사거리 — 유닛 기본 사거리 + 보너스 */
export const skillRange = (def: SkillDef, unitRange: number) => unitRange + (def.rangeBonus ?? 0);
