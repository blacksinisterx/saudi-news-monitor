// Alarm beep via WebAudio (no audio file). Browsers only allow sound after a user gesture, so unlock() runs on first tap.
let ctx: AudioContext | null = null;

export function unlockAudio() {
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
  } catch { /* no audio support */ }
}

export function playAlarm(critical: boolean) {
  unlockAudio();
  if (!ctx) return;
  const beeps = critical ? 5 : 2;
  const t0 = ctx.currentTime;
  for (let i = 0; i < beeps; i++) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "square";
    o.frequency.value = i % 2 ? 660 : 990;
    g.gain.setValueAtTime(0.0001, t0 + i * 0.28);
    g.gain.exponentialRampToValueAtTime(0.4, t0 + i * 0.28 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.28 + 0.24);
    o.connect(g).connect(ctx.destination);
    o.start(t0 + i * 0.28);
    o.stop(t0 + i * 0.28 + 0.25);
  }
  if ("vibrate" in navigator) navigator.vibrate(critical ? [300, 120, 300, 120, 600] : [200, 100, 200]);
}
