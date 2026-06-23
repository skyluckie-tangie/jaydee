# Jaydee — Session Handoff Document

**Project**: Cloud Collaborative DAW (React + Vite + TS + Tailwind + Zustand + Supabase + Web Audio)

**Date**: 2026-06-24  
**Main session owner**: You (current thread)  
**Parallel session**: Handling **Phase 3** (MIDI + Piano Roll + Subtractive Synth)

---

## Phase Status (as of now)

| Phase | Status (Main Session) | Notes / Ownership |
|-------|-----------------------|-------------------|
| **0** | Done | Basic setup, layout, alignment system |
| **1** | Done + extended | AudioEngine (channel strips, inserts, metering, routing), beat sync, demo sounds, playhead |
| **2** | Mostly complete | Multi-track arrangement, drag, trim/resize, box + multi-select, Alt+group horizontal drag (stays on own track), copy/paste at playhead, quantize (Q toggle + visual lines), undo/redo, zoom, selection visuals |
| **3** | **Skipped here** | **Parallel session is responsible**. Do **not** work on PianoRoll.tsx, SynthEngine.ts, MIDI clips, `addMidiClip`, `updateNote`, MIDI scheduling in this session. |
| **4** | Partial | Mixer UI + live faders/pan/M/S/inserts is done. AudioEngine supports inserts. **Missing**: real custom AudioWorklet for dynamics/compressor (currently using native nodes). |
| **5** | Not started | Supabase integration (auth, save/load projects, Storage for audio, Realtime for collab) |
| **6** | Partial polish | Good visual language, alignment guarantee, quantize lines, transport, shortcuts. Missing: real waveform peaks, export, more shortcuts, full stability, remove demo data |

---

## Key Decisions & Coordination Rules

- **Phase 3 is 100% owned by the parallel session**.  
  In this (main) session we actively avoid or clean MIDI/piano roll code to prevent duplication.

- **Quantize (Q key)** now affects **both clips and playhead** seeking/dragging.

- **Selection model**:
  - Click = single select (replaces)
  - Drag on background = box multi-select
  - Alt + drag a selected clip = group move (all selected clips move horizontally together, stay on their own tracks)
  - Ctrl+C / Ctrl+V = copy selected clips, paste at current playhead (snapped to current quantize)

- **Undo/Redo**: Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z). Works on clip moves, deletes, etc.

- **Alignment guarantee** (never break track ↔ clip vertical alignment):
  - Use `--track-height`, `--top-offset` CSS vars
  - `const TRACK_HEIGHT = 40` in App.tsx
  - `.top-spacer` in track-list
  - `syncScroll()` between `trackListRef` and `timelineRef`

- **Never edit independently**:
  - Track row heights
  - Spacer height
  - TRACK_HEIGHT constant
  - Playhead height calculations

---

## What Is Currently Implemented (this session)

- Strong Cubase-like Arrange view (colored tracks, sections, waveform clips, playhead with marker)
- Quantize system + visual grid lines + Q toggle (on = snap, off = free)
- Full multi-selection + box drag + Alt group drag (horizontal only)
- Copy/Paste at playhead
- Undo/Redo stack
- Trim/resize handles on selected clips
- Live volume + pan (via AudioEngine channel strips)
- Mixer panel (faders, inserts, meters)
- Insert system (add/remove/reorder, some demo EQ + Compressor)
- AudioEngine with proper signal chain (input → inserts → fader → panner → mute → master)
- Scroll sync + pixel-perfect alignment
- Demo data + test tones

---

## What Should Be Skipped Here (parallel session territory)

- Any new work on `PianoRoll.tsx`
- `SynthEngine.ts` (except if you just need to call it)
- MIDI clip creation/editing UI
- `addMidiClip`, `addNote`, `updateNote`, `deleteNote`
- MIDI scheduling / MIDI clip rendering in timeline (keep minimal if needed for compilation)

If you see MIDI code in App.tsx, you can safely treat it as "parallel's responsibility".

---

## Recommended Next Steps (Main Session)

1. **Finish Phase 4 properly**
   - Implement at least one real custom `AudioWorklet` (Dynamics Compressor or simple gate)
   - Hook it into the insert system so it actually processes audio
   - Improve Mixer insert UI (bypass, drag-to-reorder already exists)

2. **Phase 5 foundation** (biggest missing piece)
   - Set up Supabase client properly
   - Auth (simple email or anon for now)
   - Basic project save/load (store JSON in DB, audio files in Storage)
   - Minimal realtime (broadcast clip move events)

3. **Polish / Stability**
   - Real waveform peaks (instead of fake repeating gradients)
   - Proper audio file import + duration calculation
   - Export (at least simple offline mixdown)
   - More shortcuts
   - Remove or hide demo-only data

---

## How to Resume This Session

1. Run `npm run dev`
2. The current "big picture" is solid on the arrangement + mixing side.
3. Focus on **real custom FX** and **Supabase** next.
4. When you come back from the parallel session, read this file first.

---

## Coordination with Parallel Session

- Main session owns: Audio arrangement, Mixer, FX, Cloud (Phase 5+)
- Parallel owns: MIDI, PianoRoll, Synth (Phase 3)
- Communicate clearly when you need to touch shared files (types.ts, some store methods, AudioEngine base)
- If parallel needs changes in main-owned code, coordinate first.

---

**Last updated**: by Grok (this session) after recovering full context from code + chat history.

Feel free to update this file whenever you switch sessions.
