import { CLASSES, type Unit } from '../lib/units';

// 말(유닛) — 외부 에셋 없이 절차 지오메트리로만 만든 보드게임 말.
// 직업마다 실루엣이 달라 한눈에 구분된다 (검사=상자, 궁수=원뿔, 사제=기둥+구슬 …).
export default function Piece({ unit }: { unit: Unit }) {
  const c = CLASSES[unit.cls];
  const dead = !unit.alive;
  const opacity = dead ? 0.25 : 1;
  const body = () => {
    switch (unit.cls) {
      case 'sword':
        return <boxGeometry args={[0.5, 0.62, 0.5]} />;
      case 'bow':
        return <coneGeometry args={[0.3, 0.72, 6]} />;
      case 'staff':
        return <cylinderGeometry args={[0.22, 0.28, 0.68, 8]} />;
      case 'spear':
        return <boxGeometry args={[0.34, 0.8, 0.34]} />;
      case 'goblin':
        return <octahedronGeometry args={[0.36]} />;
      case 'wolf':
        return <boxGeometry args={[0.62, 0.34, 0.4]} />;
      case 'archer':
        return <coneGeometry args={[0.28, 0.66, 5]} />;
      case 'orc':
        return <boxGeometry args={[0.6, 0.68, 0.6]} />;
      case 'warlord':
        return <dodecahedronGeometry args={[0.46]} />;
      default:
        return <boxGeometry args={[0.5, 0.6, 0.5]} />;
    }
  };
  return (
    <group>
      {/* 몸통 */}
      <mesh position={[0, 0.34, 0]} castShadow>
        {body()}
        <meshStandardMaterial
          color={c.color}
          emissive={c.color}
          emissiveIntensity={dead ? 0 : 0.22}
          transparent={dead}
          opacity={opacity}
        />
      </mesh>
      {/* 받침 — 아군은 밝은 링, 적은 어두운 링 (진영 구분) */}
      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.3, 0.42, 20]} />
        <meshBasicMaterial
          color={unit.side === 'ally' ? '#cfe4ff' : '#ff9aa8'}
          transparent
          opacity={dead ? 0.15 : 0.85}
        />
      </mesh>
    </group>
  );
}
