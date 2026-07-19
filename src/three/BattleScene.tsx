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
  target: Set<string>; // 지금 바로 칠 수 있는 대상 (공격·회복·아이템)
  threat: Set<string>; // 이동해야 닿는 적 — 누르면 이동 후 공격
  path: Set<string>; // (예약) 이동 경로 미리보기
}

// r3f 포인터 이벤트 중 이 파일이 쓰는 부분만 추린 것
type ThreeEvent = {
  instanceId?: number;
  button: number;
  stopPropagation: () => void;
};

// 장식용 메시를 레이캐스트에서 빼는 표식 (하이라이트가 칸 클릭을 가리지 않도록)
const NO_RAYCAST = () => null;

// 개발 검증용 — 칸 중심의 화면 좌표(px)를 내준다.
// 클릭 판정이 실제로 그 칸에 맞는지 자동으로 확인하기 위한 것 (프로덕션 제외).
function DevProjector({ board }: { board: Board }) {
  const { camera, size, gl } = useThree();
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as Record<string, unknown>;
    w.__bqProject = (x: number, y: number) => {
      const t = TERRAIN[terrainAt(board, x, y)];
      const [wx, wz] = tileToWorld(board, x, y);
      const v = new THREE.Vector3(wx, Math.max(0, t.height) + 0.1, wz).project(camera);
      // r3f가 NDC를 만들 때 쓰는 것과 같은 기준(캔버스 rect)을 써야 왕복이 맞는다
      const r = gl.domElement.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    };
  }, [camera, size, gl, board]);
  return null;
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
  onInspect,
  onHover,
}: {
  state: BattleState;
  highlights: Highlights;
  onTile: (x: number, y: number) => void;
  /** 우클릭 — 정보만 보기 (행동하지 않음) */
  onInspect: (x: number, y: number) => void;
  /** 마우스가 올라간 칸 (터치에는 없음) */
  onHover: (x: number, y: number | null) => void;
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
    // 이동해야 닿는 적은 주황 — "지금 당장"(빨강)과 구분해 준다
    highlights.threat.forEach((k) => put(k, '#ff9f43'));
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

  // 클릭 판정 — 지형 InstancedMesh를 직접 레이캐스트해서 instanceId로 칸을 얻는다.
  // (예전엔 보드 위에 띄운 투명 평면을 썼는데, 카메라가 기울어 있어 평면 높이만큼
  //  화면상 한 칸 가까이 어긋났다. instanceId는 실제로 맞은 칸이라 어긋날 수가 없다.)
  const tileOf = (instanceId: number | undefined): [number, number] | null => {
    if (instanceId == null || instanceId < 0 || instanceId >= tileCount) return null;
    return [instanceId % board.w, Math.floor(instanceId / board.w)];
  };
  // 누름 판정 — 행동은 '뗄 때' 일어난다.
  // 우클릭은 곧바로 정보, 길게 누르기(450ms)도 정보 — 터치에서도 오조작 없이 적을 살펴볼 수 있게.
  const press = useRef<{ x: number; y: number; timer: number; long: boolean } | null>(null);
  const clearPress = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };
  const beginPress = (x: number, y: number, button: number) => {
    clearPress();
    if (button === 2) {
      onInspect(x, y);
      return;
    }
    const p = { x, y, long: false, timer: 0 };
    p.timer = window.setTimeout(() => {
      p.long = true;
      onInspect(x, y);
    }, 450);
    press.current = p;
  };
  const endPress = (x: number, y: number) => {
    const p = press.current;
    clearPress();
    if (!p || p.long) return; // 길게 눌러 정보를 봤으면 행동하지 않는다
    if (p.x !== x || p.y !== y) return; // 다른 칸에서 뗐으면 취소 (드래그 오조작 방지)
    onTile(x, y);
  };
  useEffect(() => clearPress, []);

  const onTileDown = (e: ThreeEvent) => {
    const t = tileOf(e.instanceId);
    if (!t) return;
    e.stopPropagation();
    beginPress(t[0], t[1], e.button);
  };
  const onTileUp = (e: ThreeEvent) => {
    const t = tileOf(e.instanceId);
    if (!t) return;
    e.stopPropagation();
    endPress(t[0], t[1]);
  };
  const onTileMove = (e: ThreeEvent) => {
    const t = tileOf(e.instanceId);
    if (t) onHover(t[0], t[1]);
  };

  return (
    <group>
      <CameraRig w={board.w} h={board.h} />
      <DevProjector board={board} />
      <ambientLight intensity={0.75} />
      <directionalLight position={[6, 14, 6]} intensity={1.1} />

      {/* 지형 — 클릭 판정의 기준면이기도 하다 */}
      <instancedMesh
        ref={tileRef}
        args={[undefined, undefined, tileCount]}
        frustumCulled={false}
        onPointerDown={onTileDown}
        onPointerUp={onTileUp}
        onPointerMove={onTileMove}
        onPointerOut={() => {
          clearPress();
          onHover(0, null);
        }}
      >
        <boxGeometry args={[TILE, 1, TILE]} />
        <meshStandardMaterial />
      </instancedMesh>

      {/* 하이라이트 (이동=파랑, 대상=빨강) — 장식이므로 레이캐스트에서 제외 */}
      <instancedMesh
        ref={hlRef}
        args={[undefined, undefined, tileCount]}
        frustumCulled={false}
        raycast={NO_RAYCAST}
      >
        <planeGeometry args={[TILE, TILE]} />
        <meshBasicMaterial transparent opacity={0.42} toneMapped={false} />
      </instancedMesh>

      {/* 차례 표시 링 */}
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} visible={false} raycast={NO_RAYCAST}>
        <ringGeometry args={[0.44, 0.56, 24]} />
        <meshBasicMaterial color="#ffd166" transparent opacity={0.9} toneMapped={false} />
      </mesh>

      {/* 말 + 체력 바 — 말 자체를 눌러도 그 칸을 누른 것으로 친다 */}
      {state.units.map((u) => (
        <UnitOnBoard
          key={u.id}
          unit={u}
          board={board}
          onPress={beginPress}
          onRelease={endPress}
          onHover={onHover}
        />
      ))}
    </group>
  );
}

// 말 하나 — 위치 보간(이동이 미끄러지듯) + 체력 바
function UnitOnBoard({
  unit,
  board,
  onPress,
  onRelease,
  onHover,
}: {
  unit: Unit;
  board: Board;
  onPress: (x: number, y: number, button: number) => void;
  onRelease: (x: number, y: number) => void;
  onHover: (x: number, y: number | null) => void;
}) {
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

  // 쓰러진 말은 판정에서 빼 둔다 — 그 칸으로 이동하려는 클릭을 가로막지 않도록.
  const hit = unit.alive
    ? {
        onPointerDown: (e: ThreeEvent) => {
          e.stopPropagation();
          onPress(unit.x, unit.y, e.button);
        },
        onPointerUp: (e: ThreeEvent) => {
          e.stopPropagation();
          onRelease(unit.x, unit.y);
        },
        onPointerMove: (e: ThreeEvent) => {
          e.stopPropagation();
          onHover(unit.x, unit.y);
        },
      }
    : {};

  return (
    <group ref={g} position={[wx, y, wz]} {...hit}>
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
