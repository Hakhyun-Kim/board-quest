import type { ReactNode } from 'react';
import { NODE_INFO, nextNodes, nodeById, type Journey } from '../lib/journey';
import { CLASSES, type Unit } from '../lib/units';
import { ChoiceList } from './Menu';

// 원정 지도 — 히어로즈처럼 '다음에 어느 길로 갈지' 고르는 화면.
// 노드는 절차 생성된 그래프(journey.ts)이고, 여기서는 배치와 선택만 담당한다.
//
// 2인 대전에서는 같은 지도를 양쪽에서 걸어오므로, '지금 차례인 진영'(activeId)과
// '이번에 고를 수 있는 노드'(choiceIds)를 밖에서 넣어 준다. 표시 규칙은 그대로다.

const posOf = (cols: number, col: number, row: number, rows: number) => ({
  left: `${8 + (col / (cols - 1)) * 84}%`,
  top: `${50 + (row - (rows - 1) / 2) * 22}%`,
});

export interface MapMarker {
  nodeId: number;
  icon: string;
  /** 진영 구분용 클래스 (p1 / p2) */
  cls: string;
}

export default function JourneyScreen({
  journey,
  party,
  gold,
  onTravel,
  activeId,
  choiceIds,
  markers,
  headline,
  topExtra,
}: {
  journey: Journey;
  party: Unit[];
  gold: number;
  onTravel: (id: number) => void;
  /** 지금 길을 고르는 쪽의 현재 노드 (기본 journey.currentId) */
  activeId?: number;
  /** 고를 수 있는 노드 (기본은 현재 노드에서 이어진 길) */
  choiceIds?: number[];
  /** 지도 위에 세울 말들 (대전이면 두 진영) */
  markers?: MapMarker[];
  headline?: string;
  topExtra?: ReactNode;
}) {
  const currentId = activeId ?? journey.currentId;
  const choices = choiceIds
    ? choiceIds.map((id) => nodeById(journey, id))
    : nextNodes(journey);
  const current = nodeById(journey, currentId);
  const marks = markers ?? [{ nodeId: currentId, icon: '🚩', cls: 'p1' }];

  return (
    <div className="screen journey-screen">
      <div className="journey-top">
        <span className="chip">🗺️ 원정 {journey.seed}</span>
        <span className="chip">🪙 {gold}</span>
        {topExtra}
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
              // 이번에 실제로 걸을 수 있는 길만 밝게 (어느 방향으로 걷든)
              const live =
                (n.id === currentId && choices.some((c) => c.id === t.id)) ||
                (t.id === currentId && choices.some((c) => c.id === n.id));
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
          const mark = marks.find((m) => m.nodeId === n.id);
          const isChoice = choices.some((c) => c.id === n.id);
          const cls = `map-node${mark ? ` current ${mark.cls}` : ''}${isChoice ? ' choice' : ''}${
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
              <span className="node-icon">{mark ? mark.icon : info.icon}</span>
              {mark && <span className="node-under">{info.icon}</span>}
            </button>
          );
        })}
      </div>

      <div className="journey-bottom">
        <p className="hint">
          {headline ??
            `${current.kind === 'start' ? '원정을 시작합니다 — ' : ''}다음 목적지를 고르세요 (단계 ${current.col + 1} / ${journey.cols})`}
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
