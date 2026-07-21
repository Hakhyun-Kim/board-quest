import { ITEMS } from '../lib/items';
import { CLASSES, type Unit } from '../lib/units';
import { ChoiceList, PrimaryButton } from './Menu';

// 그 밖의 화면들 — 타이틀·전투 결과·보물·야영·엔딩/전멸.

export function TitleScreen({
  best,
  muted,
  onStart,
  onVersus,
  onToggleMute,
}: {
  best: number;
  muted: boolean;
  onStart: () => void;
  /** 2인 대전 — 한 지도를 양끝에서 걸어와 마주치면 겨룬다 */
  onVersus: () => void;
  onToggleMute: () => void;
}) {
  return (
    <div className="screen title-screen">
      <button className="chip mute-btn" onClick={onToggleMute}>
        {muted ? '🔇' : '🔊'}
      </button>
      <h1>판 위의 원정대</h1>
      <p className="tagline">길을 고르고, 판 위에서 겨루는 턴제 전술 원정</p>
      <div className="howto">
        <p>🗺️ 갈림길을 골라 나아갑니다 — 전투 · 마을 · 보물 · 야영</p>
        <p>⚔️ 전투는 큰 판 위의 턴제 — 이동하고, 때리고, 반격을 조심하세요</p>
        <p>🧑‍🤝‍🧑 동료를 모으고 아이템으로 전황을 뒤집습니다</p>
        <p>👑 마지막 단계의 적장을 쓰러뜨리면 원정 성공</p>
        <p>🧑‍🤝‍🧑 둘이서 대전 — 양끝에서 출발해 마주치면 원정대끼리 겨룹니다</p>
      </div>
      {best > 0 && <p className="best">최고 기록: {best}단계 돌파</p>}
      <ChoiceList
        kind="big"
        items={[
          { key: 'solo', label: '🚩 원정 시작 (혼자)', onPick: onStart },
          { key: 'versus', label: '🧑‍🤝‍🧑 둘이서 대전 (2인)', onPick: onVersus },
        ]}
      />
    </div>
  );
}

export function BattleResultScreen({
  win,
  gold,
  exp,
  party,
  onContinue,
}: {
  win: boolean;
  gold: number;
  exp: number;
  party: Unit[];
  onContinue: () => void;
}) {
  return (
    <div className="screen result-screen">
      <h2>{win ? '🏆 승리!' : '💀 전멸…'}</h2>
      {win ? (
        <>
          <p className="hint">
            전리품 🪙 {gold} · 경험치 {exp}
          </p>
          <div className="town-status">
            {party.map((u) => (
              <span key={u.id} className="chip">
                {CLASSES[u.cls].icon} Lv.{u.level} {u.hp}/{u.maxHp}
              </span>
            ))}
          </div>
        </>
      ) : (
        <p className="hint">원정대는 여기서 멈췄다. 판은 다시 놓이면 된다.</p>
      )}
      <PrimaryButton onPick={onContinue}>{win ? '길을 계속 간다' : '처음으로'}</PrimaryButton>
    </div>
  );
}

export function TreasureScreen({
  gold,
  itemId,
  onContinue,
}: {
  gold: number;
  itemId: string | null;
  onContinue: () => void;
}) {
  const it = itemId ? ITEMS[itemId] : null;
  return (
    <div className="screen result-screen">
      <h2>💰 보물을 찾았다!</h2>
      <p className="hint">
        🪙 {gold}
        {it && ` · ${it.icon} ${it.name} ×1`}
      </p>
      <PrimaryButton onPick={onContinue}>주머니에 넣는다</PrimaryButton>
    </div>
  );
}

export function CampScreen({
  healed,
  party,
  onContinue,
}: {
  healed: number;
  party: Unit[];
  onContinue: () => void;
}) {
  return (
    <div className="screen result-screen">
      <h2>🏕️ 야영</h2>
      <p className="hint">모닥불에 둘러앉아 숨을 돌렸다 — 전원 체력 +{healed}</p>
      <div className="town-status">
        {party.map((u) => (
          <span key={u.id} className="chip">
            {CLASSES[u.cls].icon} {u.hp}/{u.maxHp}
          </span>
        ))}
      </div>
      <PrimaryButton onPick={onContinue}>다시 길을 떠난다</PrimaryButton>
    </div>
  );
}

export function EndingScreen({
  cols,
  onRestart,
}: {
  cols: number;
  onRestart: () => void;
}) {
  return (
    <div className="screen result-screen ending">
      <h1>원정 성공!</h1>
      <p className="hint">
        {cols}단계의 길을 지나 적장을 쓰러뜨렸다.
        <br />
        판이 정리되고, 말들이 제자리로 돌아간다 — 다음 판은 또 다른 지도.
      </p>
      <ChoiceList
        kind="big"
        items={[{ key: 'again', label: '새 원정을 떠난다', onPick: onRestart }]}
      />
    </div>
  );
}
