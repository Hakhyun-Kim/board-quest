import { useState } from 'react';

// 저장 중단 스위치 — 자동 시연·튜토리얼처럼 "실제 게임을 굴리지만 세이브에는 남기지 않아야"
// 하는 모드에서 쓴다 (백층 던전에서 검증된 패턴). 읽기·React 상태는 정상 동작한다.
let persistenceSuspended = false;
export function suspendPersistence(on: boolean) {
  persistenceSuspended = on;
}

// localStorage 연동 useState. 키는 모두 'bq-' 접두사 사용.
export function useLocalStorage<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw !== null ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = (v: T | ((prev: T) => T)) => {
    setValue((prev) => {
      const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v;
      try {
        if (!persistenceSuspended) localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // 사생활 보호 모드 등에서 저장 실패는 무시
      }
      return next;
    });
  };
  return [value, set] as const;
}
