import { NODE_INFO, nextNodes, nodeById, type Journey } from '../lib/journey';
import { CLASSES, type Unit } from '../lib/units';
import { ChoiceList } from './Menu';

// 원정 지도 — 히어로즈처럼 '다음에 어느 길로 갈지' 고르는 화면.
// 노드는 절차 생성된 그래프(journey.ts)이고, 여기서는 배치와 선택만 담당한다.

const posOf = (cols: number, col: number, row: number, rows: number) => ({
  left: `${8 + (col / (cols - 1)) * 84}%`,
  top: `${50 + (row - (rows - 1) / 2) * 22}%`,
});

export default function JourneyScreen({
  journey,
  party,
  gold,
  onTravel,
}: {
  journey: Journey;
  party: Unit[];
  gold: number;
  onTravel: (id: number) => void;
}) {
  const choices = nextNodes(journey);
  const current = nodeById(journey, journey.currentId);

  return (
    <div className="screen journey-screen">
      <div className="journey-top">
        <span className="chip">🗺️ 원정 {journey.seed}</span>
        <span className="chip">🪙 {gold}</span>
        <div className="party-strip">
          {party.map((u) => (
            <span key={u.id} className={`party-chip${u.hp <= 0 ? ' down' : ''}`}>
              {CLASSES[u.cls].icon}
              <em>
                {u.hp}/{u.maxHp}
              </em>
            </span>
          ))}
        </div>
      </div>

      <div className="map-area">
        {/* 길 — SVG 선 */}
        <svg className="map-lines" viewBox="0 0 100 100" preserveAspectRatio="none">
          {journey.nodes.flatMap((n) =>
            n.next.map((id) => {
              const t = nodeById(journey, id);
              const a = posOf(journey.cols, n.col, n.row, n.rows);
              const b = posOf(journey.cols, t.col, t.row, t.rows);
              const live = n.id === journey.currentId;
              return (
                <line
                  key={`${n.id}-${id}`}
                  x1={parseFloat(a.left)}
                  y1={parseFloat(a.top)}
                  x2={parseFloat(b.left)}
                  y2={parseFloat(b.top)}
                  className={live ? 'line live' : 'line'}
                />
              );
            }),
          )}
        </svg>

        {/* 노드 */}
        {journey.nodes.map((n) => {
          const info = NODE_INFO[n.kind];
          const isCurrent = n.id === journey.currentId;
          const isChoice = choices.some((c) => c.id === n.id);
          const cls = `map-node${isCurrent ? ' current' : ''}${isChoice ? ' choice' : ''}${
            n.visited ? ' visited' : ''
          }`;
          return (
            <button
              key={n.id}
              className={cls}
              style={posOf(journey.cols, n.col, n.row, n.rows)}
              disabled={!isChoice}
              onClick={() => onTravel(n.id)}
              title={info.name}
            >
              <span className="node-icon">{info.icon}</span>
            </button>
          );
        })}
      </div>

      <div className="journey-bottom">
        <p className="hint">
          {current.kind === 'start' ? '원정을 시작합니다 — ' : ''}
          다음 목적지를 고르세요 (단계 {current.col + 1} / {journey.cols})
        </p>
        <ChoiceList
          items={choices.map((n) => {
            const info = NODE_INFO[n.kind];
            return {
              key: String(n.id),
              label: `${info.icon} ${info.name}${n.kind === 'boss' ? ' — 최종 결전' : ''}`,
              onPick: () => onTravel(n.id),
            };
          })}
        />
      </div>
    </div>
  );
}
