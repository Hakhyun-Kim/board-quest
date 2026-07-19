// 유닛(말) — 직업별 기본 스탯과 성장. 전투 로직은 battle.ts, 배치는 board.ts.
// 모든 수치는 순수 데이터라 시뮬레이터로 밸런스를 측정할 수 있다.
import type { SkillId } from './skills';

export type Side = 'ally' | 'foe';

// 아군 직업 4종 + 적 5종. 아이콘은 이모지(외부 에셋 없음).
export type ClassId =
  | 'sword' // 검사 — 단단하고 반격이 매섭다
  | 'bow' // 궁수 — 멀리서 때리지만 근접에 약하다
  | 'staff' // 사제 — 회복 담당, 공격은 약하다
  | 'spear' // 창병 — 사거리 2의 근접, 반격을 잘 받아낸다
  | 'goblin'
  | 'wolf'
  | 'archer'
  | 'orc'
  | 'warlord'; // 보스

export interface ClassDef {
  id: ClassId;
  name: string;
  icon: string;
  side: Side;
  hp: number;
  atk: number;
  def: number;
  move: number; // 이동력 (지형 비용 합계로 소모)
  range: number; // 공격 사거리 (맨해튼 거리)
  speed: number; // 행동 순서 (높을수록 먼저)
  heal?: number; // 사제류: 회복량
  skill?: SkillId; // 직업 특기 (쿨다운제) — 지금은 아군 직업만 가진다
  color: string; // 말 색 (절차 지오메트리 렌더용)
  desc: string;
}

export const CLASSES: Record<ClassId, ClassDef> = {
  sword: {
    id: 'sword', name: '검사', icon: '⚔️', side: 'ally',
    hp: 36, atk: 11, def: 6, move: 4, range: 1, speed: 6, skill: 'cleave',
    color: '#5aa0ff', desc: '단단한 근접 전열. 반격이 강하다.',
  },
  bow: {
    id: 'bow', name: '궁수', icon: '🏹', side: 'ally',
    hp: 24, atk: 10, def: 3, move: 4, range: 3, speed: 8, skill: 'snipe',
    color: '#7be07a', desc: '사거리 3. 반격을 받지 않지만 몸이 약하다.',
  },
  staff: {
    id: 'staff', name: '사제', icon: '✨', side: 'ally',
    hp: 24, atk: 6, def: 3, move: 4, range: 2, speed: 5, heal: 14, skill: 'prayer',
    color: '#ffd166', desc: '아군을 회복시킨다. 원정의 생명줄.',
  },
  spear: {
    id: 'spear', name: '창병', icon: '🔱', side: 'ally',
    hp: 30, atk: 10, def: 5, move: 5, range: 2, speed: 7, skill: 'pierce',
    color: '#c06bff', desc: '사거리 2의 근접. 발이 빠르다.',
  },
  goblin: {
    id: 'goblin', name: '고블린', icon: '👺', side: 'foe',
    hp: 20, atk: 8, def: 2, move: 4, range: 1, speed: 7,
    color: '#8de07a', desc: '수로 밀어붙인다.',
  },
  wolf: {
    id: 'wolf', name: '늑대', icon: '🐺', side: 'foe',
    hp: 18, atk: 9, def: 1, move: 6, range: 1, speed: 11,
    color: '#b9aede', desc: '아주 빠르다. 후열을 노린다.',
  },
  archer: {
    id: 'archer', name: '도적 궁수', icon: '🎯', side: 'foe',
    hp: 18, atk: 8, def: 2, move: 3, range: 3, speed: 8,
    color: '#ffa03d', desc: '멀리서 쏜다. 먼저 잡아야 한다.',
  },
  orc: {
    id: 'orc', name: '오크', icon: '👹', side: 'foe',
    hp: 34, atk: 12, def: 5, move: 3, range: 1, speed: 4,
    color: '#ff5d7e', desc: '느리지만 단단하고 아프다.',
  },
  warlord: {
    id: 'warlord', name: '오크 대장', icon: '🛡️', side: 'foe',
    hp: 64, atk: 15, def: 7, move: 3, range: 1, speed: 5,
    color: '#ff3d5e', desc: '원정의 마지막 벽.',
  },
};

export interface Unit {
  id: string;
  name: string;
  cls: ClassId;
  side: Side;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  atk: number;
  def: number;
  move: number;
  range: number;
  speed: number;
  level: number;
  exp: number;
  acted: boolean; // 이번 라운드 행동 완료
  alive: boolean;
  buffAtk: number; // 아이템 등으로 이번 전투 동안 오른 공격력
  skill: SkillId | null; // 직업 특기
  cd: number; // 특기 남은 쿨다운 (0이면 쓸 수 있다). 라운드가 넘어갈 때 1씩 줄어든다
}

// 레벨에 따른 성장 — 선형(검증하기 쉬움). 레벨 1이 기본 스탯.
export function statsAt(cls: ClassId, level: number) {
  const c = CLASSES[cls];
  const g = level - 1;
  return {
    hp: c.hp + g * 5,
    atk: c.atk + g * 2,
    def: c.def + Math.floor(g * 1.2),
    speed: c.speed + Math.floor(g * 0.5),
  };
}

export function makeUnit(
  id: string,
  cls: ClassId,
  level: number,
  x: number,
  y: number,
  name?: string,
): Unit {
  const c = CLASSES[cls];
  const s = statsAt(cls, level);
  return {
    id,
    name: name ?? c.name,
    cls,
    side: c.side,
    x,
    y,
    hp: s.hp,
    maxHp: s.hp,
    atk: s.atk,
    def: s.def,
    move: c.move,
    range: c.range,
    speed: s.speed,
    level,
    exp: 0,
    acted: false,
    alive: true,
    buffAtk: 0,
    skill: c.skill ?? null,
    cd: 0,
  };
}

// 레벨업에 필요한 경험치 — 레벨당 100 (단순·예측 가능)
export const expToLevel = (level: number) => level * 100;

// 경험치를 넣고 레벨업 처리 (최대 체력 증가분은 즉시 회복)
export function gainExp(u: Unit, exp: number): { unit: Unit; levelUps: number } {
  const n = { ...u, exp: u.exp + exp };
  let levelUps = 0;
  while (n.exp >= expToLevel(n.level)) {
    n.exp -= expToLevel(n.level);
    n.level += 1;
    levelUps += 1;
    const before = n.maxHp;
    const s = statsAt(n.cls, n.level);
    n.maxHp = s.hp;
    n.atk = s.atk;
    n.def = s.def;
    n.speed = s.speed;
    n.hp = Math.min(n.maxHp, n.hp + (n.maxHp - before)); // 늘어난 만큼은 채워 준다
  }
  return { unit: n, levelUps };
}
