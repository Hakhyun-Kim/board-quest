import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { TERRAIN, key, terrainAt, type Board } from '../lib/board';
import type { BattleState } from '../lib/battle';
import type { Unit } from '../lib/units';
import Piece from './Piece';

// 전투 보드 렌더 — 지형은 InstancedMesh 한 번에, 말은 개별 메시(최대 10여 개).
// 클릭은 보드를 덮는 투명 판에서 좌표를 계산해 타일 좌표로 변환한다.

export const TILE = 1;
export const tileToWorld = (b: Board, x: number, y: number): [number, number] => [
  (x - b.w / 2 + 0.5) * TILE,
  (y - b.h / 2 + 0.5) * TILE,
];

export interface Highlights {
  move: Set<string>; // 이동 가능 칸
  target: Set<string>; // 공격·회복·아이템 대상 칸
  path: Set<string>; // (예약) 이동 경로 미리보기
}

// 화면 비율에 맞춰 보드 전체가 들어오도록 카메라를 맞춘다 (모바일 세로도 고려)
function CameraRig({ w, h }: { w: number; h: number }) {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = Math.max(0.35, size.width / Math.max(1, size.height));
    const fov = 50;
    const needH = h + 4; // 기울여 보므로 여유를 둔다
    const needW = (w + 3) / aspect;
    const span = Math.max(needH, needW);
    const dist = span / (2 * Math.tan(((fov * Math.PI) / 180) / 2));
    camera.position.set(0, dist * 0.92, dist * 0.66);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [camera, size, w, h]);
  return null;
}

export default function BattleScene({
  state,
  highlights,
  onTile,
}: {
  state: BattleState;
  highlights: Highlights;
  onTile: (x: number, y: number) => void;
}) {
  const board = state.board;
  const tileCount = board.w * board.h;
  const tileRef = useRef<THREE.InstancedMesh>(null);
  const hlRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const ringRef = useRef<THREE.Mesh>(null);

  // 지형 타일 배치 (보드가 바뀔 때만)
  useLayoutEffect(() => {
    const m = tileRef.current;
    if (!m) return;
    const color = new THREE.Color();
    for (let y = 0; y < board.h; y++) {
      for (let x = 0; x < board.w; x++) {
        const i = y * board.w + x;
        const t = TERRAIN[terrainAt(board, x, y)];
        const [wx, wz] = tileToWorld(board, x, y);
        const hgt = 0.2 + Math.max(0, t.height);
        dummy.position.set(wx, hgt / 2 - 0.1 + Math.min(0, t.height), wz);
        dummy.scale.set(0.98, hgt, 0.98);
        dummy.updateMatrix();
        m.setMatrixAt(i, dummy.matrix);
        // 체커 무늬로 칸을 구분 (보드게임 판 느낌)
        color.set(t.color);
        if ((x + y) % 2 === 0) color.multiplyScalar(1.12);
        m.setColorAt(i, color);
      }
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [board, dummy]);

  // 하이라이트(이동·대상) — 매 렌더 갱신
  useLayoutEffect(() => {
    const m = hlRef.current;
    if (!m) return;
    const color = new THREE.Color();
    let i = 0;
    const put = (k: string, c: string) => {
      const [xs, ys] = k.split(',');
      const x = Number(xs);
      const y = Number(ys);
      const t = TERRAIN[terrainAt(board, x, y)];
      const [wx, wz] = tileToWorld(board, x, y);
      dummy.position.set(wx, 0.12 + Math.max(0, t.height), wz);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.set(0.9, 0.9, 1);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      color.set(c);
      m.setColorAt(i, color);
      i++;
    };
    highlights.move.forEach((k) => put(k, '#4d8dff'));
    highlights.target.forEach((k) => put(k, '#ff4d6a'));
    // 남는 인스턴스는 화면 밖으로
    for (; i < tileCount; i++) {
      dummy.position.set(0, -50, 0);
      dummy.scale.set(0.0001, 0.0001, 0.0001);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [highlights, board, dummy, tileCount]);

  // 현재 차례 유닛 발밑의 링 — 은은하게 맥동
  const current = state.units.find((u) => u.id === state.order[state.turnIdx] && u.alive);
  useFrame((st) => {
    const r = ringRef.current;
    if (!r) return;
    if (!current) {
      r.visible = false;
      return;
    }
    const t = TERRAIN[terrainAt(board, current.x, current.y)];
    const [wx, wz] = tileToWorld(board, current.x, current.y);
    r.visible = true;
    r.position.set(wx, 0.16 + Math.max(0, t.height), wz);
    const s = 1 + Math.sin(st.clock.elapsedTime * 3) * 0.08;
    r.scale.set(s, s, s);
  });

  // 클릭 판 — 보드를 덮는 투명 평면에서 좌표 → 타일 변환
  const handleClick = (e: { point: THREE.Vector3; stopPropagation: () => void }) => {
    e.stopPropagation();
    const x = Math.floor(e.point.x / TILE + board.w / 2);
    const y = Math.floor(e.point.z / TILE + board.h / 2);
    if (x >= 0 && y >= 0 && x < board.w && y < board.h) onTile(x, y);
  };

  return (
    <group>
      <CameraRig w={board.w} h={board.h} />
      <ambientLight intensity={0.75} />
      <directionalLight position={[6, 14, 6]} intensity={1.1} />

      {/* 지형 */}
      <instancedMesh ref={tileRef} args={[undefined, undefined, tileCount]} frustumCulled={false}>
        <boxGeometry args={[TILE, 1, TILE]} />
        <meshStandardMaterial />
      </instancedMesh>

      {/* 하이라이트 (이동=파랑, 대상=빨강) */}
      <instancedMesh ref={hlRef} args={[undefined, undefined, tileCount]} frustumCulled={false}>
        <planeGeometry args={[TILE, TILE]} />
        <meshBasicMaterial transparent opacity={0.42} toneMapped={false} />
      </instancedMesh>

      {/* 차례 표시 링 */}
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.44, 0.56, 24]} />
        <meshBasicMaterial color="#ffd166" transparent opacity={0.9} toneMapped={false} />
      </mesh>

      {/* 말 + 체력 바 */}
      {state.units.map((u) => (
        <UnitOnBoard key={u.id} unit={u} board={board} />
      ))}

      {/* 클릭 판 */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 1.2, 0]}
        onPointerDown={handleClick}
        visible={false}
      >
        <planeGeometry args={[board.w * TILE, board.h * TILE]} />
        <meshBasicMaterial />
      </mesh>
    </group>
  );
}

// 말 하나 — 위치 보간(이동이 미끄러지듯) + 체력 바
function UnitOnBoard({ unit, board }: { unit: Unit; board: Board }) {
  const g = useRef<THREE.Group>(null);
  const barRef = useRef<THREE.Mesh>(null);
  const t = TERRAIN[terrainAt(board, unit.x, unit.y)];
  const [wx, wz] = tileToWorld(board, unit.x, unit.y);
  const y = Math.max(0, t.height);

  useFrame((_, dt) => {
    const grp = g.current;
    if (!grp) return;
    // 목표 칸으로 부드럽게 (턴제라도 이동이 '보이게')
    const k = 1 - Math.pow(0.001, dt);
    grp.position.x += (wx - grp.position.x) * k;
    grp.position.z += (wz - grp.position.z) * k;
    grp.position.y += (y - grp.position.y) * k;
    grp.visible = unit.alive || unit.hp <= 0; // 쓰러진 말은 흐리게 남긴다
    const bar = barRef.current;
    if (bar) {
      const ratio = Math.max(0, unit.hp / unit.maxHp);
      bar.scale.x = Math.max(0.001, ratio);
      bar.position.x = -(1 - ratio) * 0.3;
      const mat = bar.material as THREE.MeshBasicMaterial;
      mat.color.set(ratio > 0.5 ? '#7be07a' : ratio > 0.25 ? '#ffd166' : '#ff5d7e');
    }
  });

  return (
    <group ref={g} position={[wx, y, wz]}>
      <Piece unit={unit} />
      {/* 체력 바 — 카메라(약 55° 위)를 향해 살짝 눕혀 잘 보이게 */}
      {unit.alive && (
        <group position={[0, 0.95, 0]} rotation={[-0.6, 0, 0]}>
          <mesh>
            <planeGeometry args={[0.62, 0.1]} />
            <meshBasicMaterial color="#1a1f2b" toneMapped={false} />
          </mesh>
          <mesh ref={barRef} position={[0, 0, 0.01]}>
            <planeGeometry args={[0.6, 0.07]} />
            <meshBasicMaterial color="#7be07a" toneMapped={false} />
          </mesh>
        </group>
      )}
    </group>
  );
}

export const tileKey = key;
