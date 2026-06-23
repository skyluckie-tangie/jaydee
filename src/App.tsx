import { Play, Pause, Square, Plus } from 'lucide-react'
import { useProjectStore } from './stores/useProjectStore'

function App() {
  const { project, isPlaying, togglePlay, setTempo } = useProjectStore()

  return (
    <div className="daw-app bg-bg text-text">
      {/* Transport Bar - Cubase style */}
      <div className="transport-bar">
        <div className="flex items-center gap-2">
          <button className="button flex items-center gap-1" title="Stop">
            <Square size={14} />
          </button>
          <button 
            className={`button flex items-center gap-1 ${isPlaying ? 'accent' : ''}`} 
            title="Play / Pause (Phase 1 will connect to AudioEngine)"
            onClick={togglePlay}
          >
            {isPlaying ? <Pause size={14} /> : <Play size={14} />}
            <span className="ml-1">Play</span>
          </button>
        </div>

        <div className="flex items-center gap-4 text-sm ml-4">
          <div className="flex items-center gap-1">
            <span className="text-text-muted">BPM</span>
            <input 
              type="number" 
              value={project.tempo} 
              onChange={(e) => setTempo(parseInt(e.target.value) || 120)}
              className="bg-bg-elevated border border-border w-14 text-center font-mono rounded px-1 py-0.5 text-accent focus:outline-none focus:border-accent"
            />
          </div>
          <div className="font-mono text-text-muted">1.1.000</div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button className="button flex items-center gap-1">
            <Plus size={14} /> New Track
          </button>
          <div className="text-text-muted text-xs px-2">Jaydee • Local (Phase 5: cloud collab)</div>
        </div>
      </div>

      {/* Main DAW Area */}
      <div className="main-area">
        {/* Track List (left) */}
        <div className="track-list p-2">
          <div className="text-xs uppercase tracking-widest text-text-muted mb-2 px-1">Tracks ({project.tracks.length})</div>
          
          {project.tracks.map((track) => (
            <div 
              key={track.id} 
              className="bg-bg-elevated border border-border rounded p-2 mb-1 cursor-pointer hover:border-accent"
            >
              <div className="font-medium text-sm">{track.name}</div>
              <div className="text-xs text-text-muted mt-0.5">
                {track.type === 'audio' ? 'Audio' : 'Instrument'} Track
              </div>
              <div className="flex items-center gap-2 text-xs mt-1 text-text-muted">
                <span>Vol</span>
                <div className="flex-1 h-1 bg-border rounded">
                  <div className="h-1 bg-accent rounded" style={{ width: `${track.gain * 100}%` }} />
                </div>
              </div>
            </div>
          ))}

          <button className="button w-full mt-2 text-xs flex items-center justify-center gap-1">
            <Plus size={12} /> Add Track
          </button>
        </div>

        {/* Timeline / Arrangement (center) */}
        <div className="timeline flex flex-col">
          <div className="h-8 bg-bg-panel border-b border-border flex items-center px-2 text-xs text-text-muted font-mono">
            Bar  |  1 . 2 . 3 . 4 . 1 . 2 . 3 . 4     (Beat grid - Phase 1+)
          </div>

          {/* Placeholder for multi-track timeline */}
          <div className="flex-1 p-3 relative" style={{ background: 'repeating-linear-gradient(90deg, #18181b, #18181b 47px, #27272a 48px, #27272a 96px)' }}>
            {/* Fake audio clip */}
            <div className="absolute left-[60px] top-[20px] h-[52px] w-[280px] bg-accent/20 border border-accent rounded flex items-center px-2 text-xs">
              <span className="text-accent font-medium">drums.wav — 1.1 → 5.2</span>
            </div>

            {/* Fake MIDI region */}
            <div className="absolute left-[380px] top-[90px] h-[52px] w-[180px] bg-violet-400/20 border border-violet-400 rounded flex items-center px-2 text-xs">
              <span className="text-violet-400 font-medium">Bass MIDI clip</span>
            </div>

            <div className="absolute bottom-4 right-4 text-[10px] text-text-muted bg-bg-panel px-2 py-0.5 rounded border border-border">
              Canvas timeline + Piano Roll coming in Phase 1-3
            </div>
          </div>
        </div>

        {/* Mixer / Channel Strip (right) */}
        <div className="mixer p-3">
          <div className="text-xs uppercase tracking-widest text-text-muted mb-2">Mixer</div>
          
          <div className="space-y-4">
            <div>
              <div className="text-sm mb-1">Master</div>
              <div className="h-2 bg-border rounded">
                <div className="h-2 w-[85%] bg-accent rounded" />
              </div>
            </div>

            <div className="pt-2 border-t border-border">
              <div className="text-sm mb-1 text-accent">Selected Track</div>
              <div className="text-xs text-text-muted">Volume, Pan, FX inserts will appear here</div>
              <div className="mt-3 text-[10px] bg-bg-elevated p-2 rounded border border-border">
                FX Rack (Phase 4: custom AudioWorklets)
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div className="h-6 bg-bg-panel border-t border-border text-[10px] px-3 flex items-center text-text-muted">
        Jaydee • Local mode • Supabase + Realtime in Phase 5 • Tempo: {project.tempo} BPM
      </div>
    </div>
  )
}

export default App
