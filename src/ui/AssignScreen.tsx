import { CLASSES, type Unit } from '../lib/units';
import { PLAYERS, type PlayerId } from '../lib/versus';
import { PrimaryButton } from './Menu';

// 담당 배정 — 전투에 들어가기 전에 "이 말은 누가 두는가"를 정한다.
// 사람이 맡으면 지금까지처럼 판을 눌러 조작하고, 자동이면 봇(autoPlay)이 대신 둔다.
// 아이 혼자 놀 때 한쪽 진영을 통째로 자동으로 돌리거나, 아이가 한 명만 맡게 하는 데 쓴다.
export default function AssignScreen({
  title,
  hint,
  groups,
  autoIds,
  onToggle,
  onAll,
  onStart,
}: {
  title: string;
  hint?: string;
  /** 진영별 말 목록 (대전이면 둘, 성장 전투면 하나) */
  groups: { player: PlayerId; units: Unit[] }[];
  autoIds: Set<string>;
  onToggle: (unitId: string) => void;
  onAll: (player: PlayerId, auto: boolean) => void;
  onStart: () => void;
}) {
  return (
    <div className="screen assign-screen">
      <h2>{title}</h2>
      {hint && <p className="hint">{hint}</p>}

      <div className="assign-groups">
        {groups.map(({ player, units }) => {
          const p = PLAYERS[player];
          const allAuto = units.every((u) => autoIds.has(u.id));
          return (
            <div key={player} className={`assign-group ${player}`}>
              <div className="assign-head">
                <span className="chip">
                  {p.icon} {p.name}
                </span>
                <button className="chip" onClick={() => onAll(player, !allAuto)}>
                  {allAuto ? '👤 전부 사람이' : '🤖 전부 자동으로'}
                </button>
              </div>
              <div className="assign-rows">
                {units.map((u) => {
                  const auto = autoIds.has(u.id);
                  return (
                    <button
                      key={u.id}
                      className={`choice-btn assign-row${auto ? ' auto' : ''}`}
                      onClick={() => onToggle(u.id)}
                    >
                      <span>
                        {CLASSES[u.cls].icon} {u.name} Lv.{u.level}
                      </span>
                      <em>{auto ? '🤖 자동' : `👤 ${p.name}`}</em>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <PrimaryButton onPick={onStart}>전투 시작</PrimaryButton>
    </div>
  );
}
