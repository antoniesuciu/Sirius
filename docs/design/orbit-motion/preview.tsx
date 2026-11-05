import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { OrbitAvatar, type OrbitState } from './OrbitAvatar';
import artwork from './orbit.png';
import './style.css';

const states: { id: OrbitState; title: string; detail: string; phrase: string }[] = [
  { id: 'idle', title: 'Idle', detail: 'A quiet twinkle. A little life, every few seconds.', phrase: 'Here when you need me.' },
  { id: 'listening', title: 'Listening', detail: 'The orbit opens, brightens, and turns slowly.', phrase: 'I’m listening.' },
  { id: 'thinking', title: 'Thinking', detail: 'A comet of light follows the orbit.', phrase: 'Connecting the dots…' },
  { id: 'speaking', title: 'Speaking', detail: 'The star follows voice amplitude, then settles.', phrase: 'Let’s make a little progress.' },
  { id: 'needs_input', title: 'Needs input', detail: 'An amber beacon until you resolve it.', phrase: 'One thing needs your attention.' },
];

function Preview() {
  const [state, setState] = useState<OrbitState>('idle');
  const [expressive, setExpressive] = useState(false);
  const [paused, setPaused] = useState(false);
  const [light, setLight] = useState(false);
  const [demo, setDemo] = useState(true);
  const [level, setLevel] = useState(0.45);
  const [voice, setVoice] = useState(0);
  const [sequence, setSequence] = useState(false);
  const selected = states.find((entry) => entry.id === state)!;

  useEffect(() => {
    if (!demo || paused || document.hidden) return;
    let frame = 0;
    let last = 0;
    const tick = (time: number) => {
      // Deliberate preview signal, never presented as actual audio.
      if (time - last > 45) {
        const t = time / 1000;
        const syllable = Math.max(0, Math.sin(t * 5.5) * 0.58 + Math.sin(t * 11.3) * 0.25);
        setVoice(syllable * (0.5 + 0.5 * Math.sin(t * 0.7) ** 2));
        last = time;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [demo, paused]);

  useEffect(() => {
    if (!sequence || paused) return;
    const order: OrbitState[] = ['idle', 'listening', 'thinking', 'speaking', 'needs_input'];
    let step = 0;
    setState('idle');
    const timer = setInterval(() => { step = (step + 1) % order.length; setState(order[step]!); }, 3500);
    return () => clearInterval(timer);
  }, [sequence, paused]);

  const amplitude = demo ? voice : level;
  return (
    <main data-light={light}>
      <header><a href="#top" className="wordmark">sirius<span> / motion studies</span></a><button type="button" onClick={() => setLight(!light)}>{light ? 'Dark canvas' : 'Light canvas'}</button></header>
      <section className="intro" id="top"><p className="eyebrow">ORBIT · 01</p><h1>A familiar face.<br /><em>A little more alive.</em></h1><p>Five ways for Sirius to let you know what’s happening.</p></section>
      <section className="workspace" aria-label="Interactive animation preview">
        <div className="stage">
          <span className="stage-label">{expressive ? 'Expressive' : 'Subtle'} / {selected.title}</span>
          <div className="hero"><OrbitAvatar state={state} artwork={artwork} level={amplitude} size={350} still={paused} expressive={expressive} /></div>
          <div className="caption"><span className={`status-dot ${state}`} /><p>{selected.phrase}</p></div>
        </div>
        <aside>
          <p className="eyebrow">TRY A STATE</p>
          <div className="state-list">{states.map((entry, i) => <button type="button" key={entry.id} aria-pressed={entry.id === state} onClick={() => { setSequence(false); setState(entry.id); }}><span className="number">0{i + 1}</span><span><strong>{entry.title}</strong><small>{entry.detail}</small></span><span className="arrow">↗</span></button>)}</div>
          <div className="toggles"><button type="button" aria-pressed={expressive} onClick={() => setExpressive(!expressive)}>Expressive motion</button><button type="button" aria-pressed={sequence} onClick={() => setSequence(!sequence)}>Play sequence</button><button type="button" aria-pressed={paused} onClick={() => setPaused(!paused)}>{paused ? 'Resume' : 'Pause'}</button></div>
          <div className="audio-control"><label><input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} /> Simulated voice amplitude</label><label className="slider">Voice level <input aria-label="Voice level" type="range" min="0" max="1" step="0.01" disabled={demo} value={level} onChange={(e) => setLevel(Number(e.target.value))} /><output>{Math.round(amplitude * 100)}%</output></label><p>Switch off the demo signal to test silence and loudness by hand.</p></div>
        </aside>
      </section>
      <section className="studies" aria-label="All five animation studies">{states.map((entry) => <article key={entry.id}><OrbitAvatar state={entry.id} artwork={artwork} level={amplitude} size={175} still={paused} expressive={expressive} /><h2>{entry.title}</h2><p>{entry.detail}</p></article>)}</section>
      <footer>Independent animation studies · GSAP + SVG · Reduced motion supported</footer>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Preview /></StrictMode>);
