import { AbsoluteFill, Img, staticFile } from 'remotion';

const FONT = '"Segoe UI Variable", "Segoe UI", system-ui, sans-serif';
const INK = '#1b1c21';
const INK_2 = '#4f5059';
const YELLOW = '#fdb913';

const Sticky = ({ x, y, rot, color, title, body }: { x: number; y: number; rot: number; color: string; title: string; body: string }) => (
  <div
    style={{
      position: 'absolute',
      left: x,
      top: y,
      width: 330,
      height: 270,
      background: color,
      borderRadius: 14,
      padding: 28,
      fontFamily: FONT,
      color: '#2b2616',
      transform: `rotate(${rot}deg)`,
      boxShadow: '0 30px 50px rgba(24,28,44,0.22), 0 4px 8px rgba(24,28,44,0.12)'
    }}
  >
    <div style={{ fontSize: 36, fontWeight: 800, marginBottom: 12 }}>{title}</div>
    <div style={{ fontSize: 28, lineHeight: 1.4, opacity: 0.85 }}>{body}</div>
  </div>
);

/** 1920x1080 store/trailer thumbnail. Sample text only. */
export const Thumbnail = () => (
  <AbsoluteFill style={{ background: '#f5f1ea', fontFamily: FONT }}>
    <AbsoluteFill
      style={{
        background:
          'radial-gradient(1000px 800px at 18% 22%, rgba(253,185,19,0.30), transparent 62%), radial-gradient(1100px 900px at 88% 92%, rgba(255,140,110,0.22), transparent 62%), radial-gradient(900px 700px at 62% 8%, rgba(120,140,255,0.14), transparent 62%)'
      }}
    />
    <Sticky x={1060} y={90} rot={-6} color="#fbe38a" title="Monday" body="Draft the launch post." />
    <Sticky x={1450} y={110} rot={5} color="#f9b4c4" title="Tuesday" body="Book flights. Pack charger." />
    <Img
      src={staticFile('nottli-cat-idle.png')}
      style={{ position: 'absolute', right: 120, bottom: -40, width: 920, height: 920, filter: 'drop-shadow(0 40px 50px rgba(24,28,44,0.3))' }}
    />
    <div style={{ position: 'absolute', left: 120, top: 0, bottom: 0, width: 900, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
        <Img src={staticFile('nottli-icon.png')} style={{ width: 170, height: 170 }} />
        <div style={{ fontSize: 190, fontWeight: 800, color: INK, letterSpacing: -6 }}>Nottli</div>
      </div>
      <div style={{ marginTop: 36, fontSize: 64, lineHeight: 1.15, fontWeight: 650, color: INK_2 }}>Your desktop note companion.</div>
      <div style={{ marginTop: 48, display: 'flex' }}>
        <div style={{ padding: '20px 48px', borderRadius: 999, fontSize: 40, fontWeight: 700, color: INK, background: YELLOW }}>Quick notes · Stickies · Private</div>
      </div>
    </div>
  </AbsoluteFill>
);
