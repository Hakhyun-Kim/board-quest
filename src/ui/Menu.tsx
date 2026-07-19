import { useEffect, useRef, useState, type ReactNode } from 'react';
import { sfx } from '../lib/sound';

// ── 표준 메뉴 선택 시스템 (백층 던전에서 검증된 규약을 그대로 이식)
// 모든 선택 화면의 공통 규칙:
//  · 항상 한 항목이 하이라이트되어 있다 (기본 = 첫 활성 항목, .focused)
//  · 방향키(←↑ / →↓)로 하이라이트 이동, Enter/Space로 확정, 숫자 1~9는 바로 선택
//  · 마우스 호버는 하이라이트와 동기화, 클릭은 즉시 확정
// 메뉴가 여러 개 겹치면 나중에 열린 메뉴만 키 입력을 받는다 (모듈 레벨 스택).
// 자동 반복(e.repeat) 입력은 무시한다.

const menuStack: symbol[] = [];

export function useMenuStack(): () => boolean {
  const idRef = useRef<symbol | null>(null);
  if (!idRef.current) idRef.current = Symbol('menu');
  useEffect(() => {
    const id = idRef.current!;
    menuStack.push(id);
    return () => {
      const i = menuStack.indexOf(id);
      if (i >= 0) menuStack.splice(i, 1);
    };
  }, []);
  return () => menuStack[menuStack.length - 1] === idRef.current;
}

const isTyping = (e: KeyboardEvent) => (e.target as HTMLElement)?.tagName === 'INPUT';
const NUM_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

export interface MenuItem {
  key: string;
  label: ReactNode;
  disabled?: boolean;
  className?: string;
  onPick: () => void;
}

export function ChoiceList({
  items,
  kind = 'choice',
  containerClass,
}: {
  items: MenuItem[];
  /** choice = 세로 선택지, card = 카드, big = 큰 진행 버튼 */
  kind?: 'choice' | 'card' | 'big';
  containerClass?: string;
}) {
  const isTop = useMenuStack();
  const [focus, setFocus] = useState(() => Math.max(0, items.findIndex((it) => !it.disabled)));
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const focusRef = useRef(focus);
  focusRef.current = focus;

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!isTop() || e.repeat || isTyping(e)) return;
      const its = itemsRef.current;
      if (!its.length) return;
      const move = (dir: 1 | -1) => {
        e.preventDefault();
        let i = focusRef.current;
        for (let step = 0; step < its.length; step++) {
          i = (i + dir + its.length) % its.length;
          if (!its[i].disabled) break;
        }
        if (i !== focusRef.current) sfx.tap();
        focusRef.current = i; // 연타가 와도 이어서 움직이게 즉시 갱신
        setFocus(i);
      };
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') return move(-1);
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') return move(1);
      if (e.key === 'Enter' || e.key === ' ') {
        const it = its[focusRef.current];
        if (it && !it.disabled) {
          e.preventDefault();
          it.onPick();
        }
        return;
      }
      const num = NUM_KEYS.indexOf(e.key);
      if (num >= 0) {
        const it = its[num];
        if (it && !it.disabled) {
          e.preventDefault();
          it.onPick();
        }
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const btnClass = kind === 'card' ? 'card' : kind === 'big' ? 'big-btn' : 'choice-btn';
  const boxClass =
    containerClass ?? (kind === 'card' ? 'cards' : kind === 'big' ? 'menu-col' : 'choices');
  return (
    <div className={boxClass}>
      {items.map((it, i) => (
        <button
          key={it.key}
          className={`${btnClass}${it.className ? ` ${it.className}` : ''}${i === focus ? ' focused' : ''}`}
          disabled={it.disabled}
          onMouseEnter={() => {
            if (!it.disabled) setFocus(i);
          }}
          onClick={(e) => {
            e.stopPropagation();
            it.onPick();
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

// 화면의 유일한 진행 버튼 — 항상 선택된 상태로 보이고 Enter/Space/→ 로 확정
export function PrimaryButton({
  className,
  onPick,
  children,
}: {
  className?: string;
  onPick: () => void;
  children: ReactNode;
}) {
  const isTop = useMenuStack();
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!isTop() || e.repeat || isTyping(e)) return;
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') {
        e.preventDefault();
        pickRef.current();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <button
      className={`big-btn focused${className ? ` ${className}` : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onPick();
      }}
    >
      {children}
    </button>
  );
}
