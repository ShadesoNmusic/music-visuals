# ShadesoN Music Visualizer (scaffold)
9:16 neon wireframe tunnel (1080×1920 backing, 540×960 logical) reacting to audio. No build step; Three.js 0.160 via unpkg import map.

## Run
    cd music-visuals/app && python3 -m http.server 8000
Open http://localhost:8000 → LOAD TRACK (mp3/wav/m4a). Double-tap hook text to edit; pause from the bottom bar or Space.

## Record (TikTok)
Once a track is playing, hit **● REC** in the bottom bar. Stops with **■ STOP** and downloads a `shadeson-visual-….webm` at 1080×1920 with hook text + optional BPM burned in and the audio track included (MediaRecorder / BitAndPlay path). Chrome/Edge/Firefox desktop; Safari support varies.

Safe zones: top 10% / bottom 20% eaten by TikTok UI; hook + BPM sit in center third.

## Audio API contract (for 01010)
`audio.js` must export `audio` (named + default):
```js
audio = {
  bass: 0..1, mid: 0..1, treble: 0..1, // smoothed band energy (20–250, 250–2k, 2k–12k Hz)
  beat: boolean,   // true only on the frame a kick onset fires
  kick: 0..1,      // envelope: 1 on beat, decays ~4/s
  bpm: number,     // 0 if unknown
  element: HTMLAudioElement|null,
  load(fileOrUrl): Promise<HTMLAudioElement>, // ui.js calls .play() on result
  update(dtSeconds): audio                    // called once per rAF by ui.js
}
```
