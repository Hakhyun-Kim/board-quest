// Web Audio 합성 효과음 — 오디오 파일 0개 (외부 에셋 금지 원칙).
// 턴제 게임이라 소리가 '행동의 확인'을 담당한다: 선택·이동·타격·회복·처치·승패.
let ac: AudioContext | null = null;
export function getAc(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ac) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ac = new Ctor();
  }
  if (ac.state === 'suspended') void ac.resume();
  return ac;
}

let muted = (() => {
  try {
    return localStorage.getItem('bq-muted') === '1';
  } catch {
    return false;
  }
})();

export const isMuted = () => muted;
export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem('bq-muted', m ? '1' : '0');
  } catch {
    // 사생활 보호 모드 등 저장 실패는 무시
  }
}

type Wave = OscillatorType;

// 단음 — 주파수를 f0에서 f1으로 미끄러뜨리며 감쇠
function tone(f0: number, f1: number, dur: number, wave: Wave = 'square', gain = 0.06, delay = 0) {
  const a = getAc();
  if (!a || muted) return;
  const t = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = wave;
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

// 잡음 — 타격감용 짧은 노이즈
function noise(dur: number, gain = 0.08, delay = 0) {
  const a = getAc();
  if (!a || muted) return;
  const t = a.currentTime + delay;
  const len = Math.max(1, Math.floor(a.sampleRate * dur));
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource();
  const g = a.createGain();
  src.buffer = buf;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(g).connect(a.destination);
  src.start(t);
}

export const sfx = {
  tap: () => tone(520, 640, 0.06, 'square', 0.04),
  select: () => tone(700, 900, 0.08, 'triangle', 0.05),
  cancel: () => tone(400, 260, 0.09, 'square', 0.045),
  move: () => {
    tone(300, 420, 0.07, 'triangle', 0.045);
    tone(420, 520, 0.06, 'triangle', 0.035, 0.06);
  },
  hit: () => {
    noise(0.12, 0.09);
    tone(180, 90, 0.12, 'sawtooth', 0.05);
  },
  crit: () => {
    noise(0.16, 0.11);
    tone(240, 80, 0.18, 'sawtooth', 0.07);
  },
  heal: () => {
    tone(620, 880, 0.16, 'sine', 0.05);
    tone(880, 1180, 0.18, 'sine', 0.04, 0.08);
  },
  item: () => tone(760, 1020, 0.12, 'triangle', 0.05),
  kill: () => {
    noise(0.22, 0.1);
    tone(320, 60, 0.26, 'square', 0.06);
  },
  turn: () => tone(480, 520, 0.1, 'sine', 0.035),
  coin: () => {
    tone(1000, 1300, 0.08, 'square', 0.045);
    tone(1300, 1600, 0.1, 'square', 0.035, 0.07);
  },
  win: () => {
    [523, 659, 784, 1046].forEach((f, i) => tone(f, f, 0.2, 'triangle', 0.06, i * 0.12));
  },
  lose: () => {
    [392, 330, 262, 196].forEach((f, i) => tone(f, f * 0.98, 0.3, 'sawtooth', 0.05, i * 0.16));
  },
  march: () => {
    tone(300, 380, 0.1, 'triangle', 0.05);
    tone(380, 460, 0.12, 'triangle', 0.04, 0.1);
  },
};
