import type { CSSProperties, ReactNode } from 'react';
import { AbsoluteFill, Easing, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

export const FPS = 30;

// Scene lengths in seconds. All sample text in this video is made up.
const SCENES = { logo: 4, meet: 6, capture: 7, pin: 7, find: 7, clip: 5, privacy: 5, end: 4 } as const;
const f = (s: number) => Math.round(s * FPS);
const START = (() => {
  let at = 0;
  const out = {} as Record<keyof typeof SCENES, number>;
  (Object.keys(SCENES) as (keyof typeof SCENES)[]).forEach((k) => {
    out[k] = at;
    at += f(SCENES[k]);
  });
  return out;
})();
export const TOTAL_FRAMES = Object.values(SCENES).reduce((a, s) => a + f(s), 0);

const FONT = '"Segoe UI Variable", "Segoe UI", system-ui, sans-serif';
const YELLOW = '#fdb913';
const INK = '#1b1c21';
const INK_2 = '#4f5059';
const PANEL = { bg: '#18191e', card: '#22232a', text: '#f2f1ef', text2: '#bdbdc6', text3: '#8d8e99', accent: '#ff8b74', ok: '#8fc287' };

// ---------- helpers ----------
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/** Fades a scene in and out so cuts feel soft. */
const Scene = ({ seconds, children }: { seconds: number; children: ReactNode }) => {
  const frame = useCurrentFrame();
  const total = f(seconds);
  const opacity = interpolate(frame, [0, 10, total - 10, total], [0, 1, 1, 0], clamp);
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

const Backdrop = ({ tint = 0 }: { tint?: number }) => {
  const frame = useCurrentFrame();
  const drift = Math.sin((frame + tint * 200) / 90) * 40;
  return (
    <AbsoluteFill style={{ background: '#f5f1ea' }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(900px 700px at ${20 + drift / 10}% 20%, rgba(253,185,19,0.22), transparent 60%), radial-gradient(1000px 800px at 85% 90%, rgba(255,140,110,0.16), transparent 60%), radial-gradient(800px 600px at 60% 10%, rgba(120,140,255,0.12), transparent 60%)`
        }}
      />
    </AbsoluteFill>
  );
};

const useSpring = (delay = 0, damping = 14) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping, stiffness: 120, mass: 0.9 } });
};

/** Headline + sub text block on the left of a scene. */
const Caption = ({ title, sub, delay = 6 }: { title: string; sub?: string; delay?: number }) => {
  const frame = useCurrentFrame();
  const rise = (d: number) => interpolate(frame, [d, d + 18], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const style = (d: number): CSSProperties => ({ opacity: rise(d), transform: `translateY(${(1 - rise(d)) * 28}px)` });
  return (
    <div style={{ position: 'absolute', left: 130, top: 0, bottom: 0, width: 880, display: 'flex', flexDirection: 'column', justifyContent: 'center', fontFamily: FONT }}>
      <div style={{ ...style(delay), fontSize: 84, lineHeight: 1.04, fontWeight: 800, color: INK, letterSpacing: -2 }}>{title}</div>
      {sub ? <div style={{ ...style(delay + 10), marginTop: 28, fontSize: 38, lineHeight: 1.35, color: INK_2, fontWeight: 500 }}>{sub}</div> : null}
    </div>
  );
};

const typed = (text: string, frame: number, start: number, cps = 1.1) => text.slice(0, Math.max(0, Math.floor((frame - start) * cps)));

const Caret = () => {
  const frame = useCurrentFrame();
  return <span style={{ display: 'inline-block', width: 3, height: '1.05em', background: PANEL.accent, marginLeft: 3, verticalAlign: 'text-bottom', opacity: Math.floor(frame / 15) % 2 === 0 ? 1 : 0 }} />;
};

// ---------- the Nottli panel mock-up (matches the app's dark theme) ----------
type Tab = 'create' | 'notes' | 'clipboard';

const Tabs = ({ tab }: { tab: Tab }) => (
  <div style={{ display: 'flex', gap: 6, padding: 6, background: 'rgba(255,255,255,0.07)', borderRadius: 999, border: '1px solid rgba(255,255,255,0.08)' }}>
    {(['create', 'notes', 'clipboard'] as Tab[]).map((t) => (
      <div
        key={t}
        style={{
          padding: '10px 26px',
          borderRadius: 999,
          fontSize: 22,
          fontWeight: 650,
          color: t === tab ? PANEL.text : PANEL.text3,
          background: t === tab ? 'linear-gradient(180deg, rgba(255,255,255,0.24), rgba(255,255,255,0.08))' : 'transparent',
          textTransform: 'capitalize'
        }}
      >
        {t}
      </div>
    ))}
  </div>
);

const Panel = ({ tab, children }: { tab: Tab; children: ReactNode }) => (
  <div
    style={{
      width: 640,
      height: 820,
      borderRadius: 40,
      background: `linear-gradient(160deg, ${PANEL.bg}, #14151a)`,
      boxShadow: '0 60px 120px rgba(24,28,44,0.38), 0 0 0 1px rgba(255,255,255,0.06)',
      padding: 34,
      fontFamily: FONT,
      color: PANEL.text,
      display: 'flex',
      flexDirection: 'column',
      gap: 24
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
      <Img src={staticFile('nottli-icon.png')} style={{ width: 46, height: 46 }} />
      <Tabs tab={tab} />
    </div>
    {children}
  </div>
);

const Pill = ({ children }: { children: ReactNode }) => (
  <div style={{ padding: '12px 24px', borderRadius: 999, fontSize: 22, fontWeight: 650, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.1)' }}>{children}</div>
);

const Cat = ({ size = 640, delay = 0 }: { size?: number; delay?: number }) => {
  const frame = useCurrentFrame();
  const enter = useSpring(delay, 11);
  const bob = Math.sin(frame / 14) * 6;
  return (
    <Img
      src={staticFile('nottli-cat-idle.png')}
      style={{ width: size, height: size, transform: `translateY(${(1 - enter) * 260 + bob}px) scale(${0.85 + enter * 0.15})`, opacity: Math.min(1, enter * 1.4), filter: 'drop-shadow(0 30px 40px rgba(24,28,44,0.28))' }}
    />
  );
};

// ---------- scenes ----------
const LogoScene = () => {
  const frame = useCurrentFrame();
  const pop = useSpring(4, 12);
  const word = interpolate(frame, [26, 48], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const tag = interpolate(frame, [58, 82], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  return (
    <Scene seconds={SCENES.logo}>
      <Backdrop />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', fontFamily: FONT }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 44 }}>
          <Img src={staticFile('nottli-icon.png')} style={{ width: 260, height: 260, transform: `scale(${0.4 + pop * 0.6}) rotate(${(1 - pop) * -14}deg)`, opacity: Math.min(1, pop * 1.5) }} />
          <div style={{ fontSize: 230, fontWeight: 800, color: INK, letterSpacing: -8, opacity: word, transform: `translateX(${(1 - word) * -40}px)` }}>Nottli</div>
        </div>
        <div style={{ marginTop: 40, fontSize: 52, color: INK_2, fontWeight: 500, opacity: tag, transform: `translateY(${(1 - tag) * 20}px)` }}>Your thoughts, always within reach.</div>
      </AbsoluteFill>
    </Scene>
  );
};

const MeetScene = () => (
  <Scene seconds={SCENES.meet}>
    <Backdrop tint={1} />
    <Caption title="Meet your desktop companion." sub="A small, animated friend that lives on your screen and is always ready for your next note." />
    <div style={{ position: 'absolute', right: 130, bottom: 40 }}>
      <Cat size={780} delay={4} />
    </div>
  </Scene>
);

const CaptureScene = () => {
  const frame = useCurrentFrame();
  const enter = useSpring(4, 15);
  const text = typed('Pick up groceries, then draft the launch post.', frame, 40, 0.9);
  const chip = interpolate(frame, [14, 30], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  return (
    <Scene seconds={SCENES.capture}>
      <Backdrop tint={2} />
      <Caption title="Capture a thought instantly." sub="Press your shortcut and a fresh note is ready before the idea slips away." />
      <div style={{ position: 'absolute', left: 130, bottom: 150, display: 'flex', gap: 14, opacity: chip, transform: `translateY(${(1 - chip) * 16}px)`, fontFamily: FONT }}>
        {['Ctrl', 'Alt', 'N'].map((k) => (
          <div key={k} style={{ minWidth: 96, textAlign: 'center', padding: '16px 26px', borderRadius: 18, fontSize: 38, fontWeight: 700, color: INK, background: '#fffffd', boxShadow: '0 6px 0 rgba(24,28,44,0.14), 0 14px 30px rgba(24,28,44,0.12)' }}>
            {k}
          </div>
        ))}
      </div>
      <div style={{ position: 'absolute', right: 150, top: 130, transform: `translateY(${(1 - enter) * 120}px) scale(${0.94 + enter * 0.06})`, opacity: enter }}>
        <Panel tab="create">
          <div style={{ fontSize: 40, fontWeight: 800 }}>Monday</div>
          <div style={{ flex: 1, background: PANEL.card, border: '2px solid rgba(255,139,116,0.55)', borderRadius: 26, padding: 30, fontSize: 32, lineHeight: 1.45, color: PANEL.text }}>
            {text}
            <Caret />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ fontSize: 22, color: PANEL.ok, flex: 1 }}>✓ Saved · just now</div>
            <Pill>On desktop</Pill>
            <Pill>+ New note</Pill>
          </div>
        </Panel>
      </div>
    </Scene>
  );
};

const Sticky = ({ x, y, rot, color, title, body, delay, w = 380, h = 330 }: { x: number; y: number; rot: number; color: string; title: string; body: string; delay: number; w?: number; h?: number }) => {
  const s = useSpring(delay, 9);
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        background: color,
        borderRadius: 14,
        padding: 30,
        fontFamily: FONT,
        color: '#2b2616',
        boxShadow: '0 30px 50px rgba(24,28,44,0.22), 0 4px 8px rgba(24,28,44,0.12)',
        transform: `rotate(${rot}deg) scale(${s}) translateY(${(1 - s) * -60}px)`,
        opacity: Math.min(1, s * 2)
      }}
    >
      <div style={{ fontSize: 38, fontWeight: 800, marginBottom: 14 }}>{title}</div>
      <div style={{ fontSize: 30, lineHeight: 1.4, opacity: 0.85 }}>{body}</div>
    </div>
  );
};

const PinScene = () => (
  <Scene seconds={SCENES.pin}>
    <Backdrop tint={3} />
    <Caption title="Pin it. Keep it in sight." sub="Turn any note into a sticky on your desktop, in the colors you like." />
    <Sticky x={1040} y={120} rot={-4} color="#fbe38a" title="Monday" body="Draft the launch post." delay={26} />
    <Sticky x={1380} y={250} rot={3} color="#f9b4c4" title="Tuesday" body="Book flights. Pack charger." delay={44} />
    <Sticky x={1090} y={510} rot={2} color="#9fdcd2" title="Ideas" body="Weekend trip. New playlist." delay={62} w={360} h={300} />
    <div style={{ position: 'absolute', left: 1500, top: 640 }}>
      <Cat size={330} delay={80} />
    </div>
  </Scene>
);

const NOTES = [
  { t: 'Groceries', b: 'Milk, eggs, coffee beans' },
  { t: 'Launch post', b: 'Draft the intro paragraph' },
  { t: 'Reading list', b: 'Three articles to finish' },
  { t: 'Gift ideas', b: 'Birthday on Friday' }
];

const FindScene = () => {
  const frame = useCurrentFrame();
  const enter = useSpring(4, 15);
  const query = typed('launch', frame, 50, 0.22);
  const shown = NOTES.filter((n) => (n.t + ' ' + n.b).toLowerCase().includes(query.toLowerCase()));
  return (
    <Scene seconds={SCENES.find}>
      <Backdrop tint={4} />
      <Caption title="Find anything in seconds." sub="Instant search across every title and word in your notes." />
      <div style={{ position: 'absolute', right: 150, top: 130, transform: `translateY(${(1 - enter) * 120}px)`, opacity: enter }}>
        <Panel tab="notes">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, background: PANEL.card, border: '1px solid rgba(255,255,255,0.1)', borderRadius: 22, padding: '20px 26px', fontSize: 30 }}>
            <span style={{ color: PANEL.text3 }}>⌕</span>
            <span style={{ color: query ? PANEL.text : PANEL.text3 }}>{query || 'Search title and content'}</span>
            {query ? <Caret /> : null}
          </div>
          <div style={{ fontSize: 18, letterSpacing: 2, color: PANEL.text3 }}>ALL NOTES · {shown.length}</div>
          {shown.map((n) => (
            <div key={n.t} style={{ background: PANEL.card, borderRadius: 24, padding: '26px 30px', border: '1px solid rgba(255,255,255,0.07)' }}>
              <div style={{ fontSize: 32, fontWeight: 750 }}>{n.t}</div>
              <div style={{ fontSize: 26, color: PANEL.text2, marginTop: 6 }}>{n.b}</div>
            </div>
          ))}
        </Panel>
      </div>
    </Scene>
  );
};

const CLIPS = ['Call dentist tomorrow', 'Room 204, second floor', 'Pasta recipe: 12 minutes'];

const ClipScene = () => {
  const frame = useCurrentFrame();
  const enter = useSpring(4, 15);
  const on = frame > 50;
  const knob = interpolate(frame, [50, 62], [0, 1], clamp);
  return (
    <Scene seconds={SCENES.clip}>
      <Backdrop tint={5} />
      <Caption title="Optional clipboard history." sub="Off until you turn it on. Search what you copied, whenever you need it." />
      <div style={{ position: 'absolute', right: 150, top: 130, transform: `translateY(${(1 - enter) * 120}px)`, opacity: enter }}>
        <Panel tab="clipboard">
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, background: PANEL.card, borderRadius: 24, padding: '22px 28px' }}>
            <div style={{ width: 16, height: 16, borderRadius: 99, background: on ? PANEL.ok : PANEL.text3 }} />
            <div style={{ flex: 1, fontSize: 30, fontWeight: 700 }}>{on ? 'Monitoring on' : 'Monitoring off'}</div>
            <div style={{ width: 84, height: 46, borderRadius: 99, background: on ? PANEL.ok : 'rgba(255,255,255,0.14)', position: 'relative' }}>
              <div style={{ position: 'absolute', top: 5, left: 5 + knob * 38, width: 36, height: 36, borderRadius: 99, background: '#fff' }} />
            </div>
          </div>
          {on
            ? CLIPS.map((c, i) => {
                const a = interpolate(frame, [64 + i * 10, 78 + i * 10], [0, 1], clamp);
                return (
                  <div key={c} style={{ opacity: a, transform: `translateY(${(1 - a) * 20}px)`, background: PANEL.card, borderRadius: 24, padding: '24px 30px', fontSize: 30 }}>
                    {c}
                  </div>
                );
              })
            : null}
        </Panel>
      </div>
    </Scene>
  );
};

const Lock = ({ size = 220 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="10.5" width="16" height="10.5" rx="3" fill={YELLOW} />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    <circle cx="12" cy="15.7" r="1.3" fill={INK} stroke="none" />
  </svg>
);

const PrivacyScene = () => {
  const frame = useCurrentFrame();
  const lock = useSpring(4, 10);
  return (
    <Scene seconds={SCENES.privacy}>
      <Backdrop tint={6} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', fontFamily: FONT }}>
        <div style={{ transform: `scale(${0.5 + lock * 0.5})`, opacity: Math.min(1, lock * 1.6) }}>
          <Lock />
        </div>
        <div style={{ marginTop: 30, fontSize: 96, fontWeight: 800, color: INK, letterSpacing: -2, opacity: interpolate(frame, [10, 30], [0, 1], clamp) }}>Private by design.</div>
        <div style={{ display: 'flex', gap: 24, marginTop: 56 }}>
          {['Stored on your PC', 'No account', 'No cloud'].map((c, i) => {
            const a = interpolate(frame, [34 + i * 12, 52 + i * 12], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
            return (
              <div key={c} style={{ opacity: a, transform: `translateY(${(1 - a) * 24}px)`, padding: '22px 44px', borderRadius: 999, fontSize: 42, fontWeight: 650, color: INK, background: '#fffffd', boxShadow: '0 12px 30px rgba(24,28,44,0.12)' }}>
                {c}
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </Scene>
  );
};

const EndScene = () => {
  const frame = useCurrentFrame();
  const pop = useSpring(2, 12);
  const a = interpolate(frame, [20, 44], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const b = interpolate(frame, [40, 64], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  return (
    <Scene seconds={SCENES.end}>
      <Backdrop tint={7} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', fontFamily: FONT }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 36, transform: `scale(${0.9 + pop * 0.1})`, opacity: Math.min(1, pop * 1.5) }}>
          <Img src={staticFile('nottli-icon.png')} style={{ width: 200, height: 200 }} />
          <div style={{ fontSize: 190, fontWeight: 800, color: INK, letterSpacing: -6 }}>Nottli</div>
        </div>
        <div style={{ marginTop: 40, fontSize: 56, color: INK_2, fontWeight: 500, opacity: a, transform: `translateY(${(1 - a) * 18}px)` }}>Your thoughts, always within reach.</div>
        <div style={{ marginTop: 44, padding: '22px 56px', borderRadius: 999, fontSize: 44, fontWeight: 700, color: INK, background: YELLOW, opacity: b, transform: `translateY(${(1 - b) * 18}px)` }}>Coming soon to the Microsoft Store</div>
      </AbsoluteFill>
    </Scene>
  );
};

export const Trailer = () => (
  <AbsoluteFill style={{ background: '#f5f1ea' }}>
    <Sequence from={START.logo} durationInFrames={f(SCENES.logo)}><LogoScene /></Sequence>
    <Sequence from={START.meet} durationInFrames={f(SCENES.meet)}><MeetScene /></Sequence>
    <Sequence from={START.capture} durationInFrames={f(SCENES.capture)}><CaptureScene /></Sequence>
    <Sequence from={START.pin} durationInFrames={f(SCENES.pin)}><PinScene /></Sequence>
    <Sequence from={START.find} durationInFrames={f(SCENES.find)}><FindScene /></Sequence>
    <Sequence from={START.clip} durationInFrames={f(SCENES.clip)}><ClipScene /></Sequence>
    <Sequence from={START.privacy} durationInFrames={f(SCENES.privacy)}><PrivacyScene /></Sequence>
    <Sequence from={START.end} durationInFrames={f(SCENES.end)}><EndScene /></Sequence>
  </AbsoluteFill>
);
