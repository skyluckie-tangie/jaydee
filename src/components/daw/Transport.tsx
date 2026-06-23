import { useState, useEffect } from 'react'
import { Play, Pause, Square, ZoomOut, ZoomIn, SkipBack } from 'lucide-react'
import { useProjectStore } from '../../stores/useProjectStore'


function formatPosition(beat: number, beatsPerBar: number = 4): string {
  const bar = Math.floor(beat / beatsPerBar) + 1
  const beatInBar = Math.floor(beat % beatsPerBar) + 1
  const sub = Math.floor((beat % 1) * 100)
  return `${bar.toString().padStart(3, '0')}.${beatInBar}.${sub.toString().padStart(2, '0')}`
}

export function Transport({
  onZoomOut,
  onZoomIn,
  onGoToZero,
}: {
  onZoomOut?: () => void
  onZoomIn?: () => void
  onGoToZero?: () => void
} = {}) {
  const { 
    project, 
    isPlaying, 
    currentBeat, 
    togglePlay, 
    stop, 
    setTempo,
    quantize,
    setQuantize,
    isQuantizeOn,
    toggleQuantize,
    loopEnabled,
    toggleLoop,
    metronomeEnabled,
    toggleMetronome
  } = useProjectStore()

  // Local input value so user can type freely (e.g. delete digits)
  const [bpmInput, setBpmInput] = useState(project.tempo.toString())

  // Sync from store when tempo changes externally (but not while user is typing)
  useEffect(() => {
    setBpmInput(project.tempo.toString())
  }, [project.tempo])

  const handleBpmChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setBpmInput(val)

    const num = parseInt(val, 10)
    // Only apply if it's a valid number in reasonable range.
    // No hard clamping — out of range values are simply ignored.
    if (!isNaN(num) && num >= 40 && num <= 300) {
      setTempo(num)
    }
    // If out of range or empty/invalid, we keep showing what user typed,
    // but don't update the actual tempo.
  }

  const handleBpmBlur = () => {
    // On blur, if current input is invalid, reset to actual tempo
    const num = parseInt(bpmInput, 10)
    if (isNaN(num) || num < 40 || num > 300) {
      setBpmInput(project.tempo.toString())
    }
  }

  return (
    <div className="transport-bar">
      {/* Left: Transport Controls */}
      <div className="flex items-center gap-1 transport-controls">
        <button 
          onClick={() => { stop() }}
          className="transport-btn" 
          title="Stop (Space)"
        >
          <Square size={16} />
        </button>
        <button 
          onClick={() => { togglePlay() }}
          className={`transport-btn play-btn ${isPlaying ? 'playing' : ''}`}
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <Pause size={18} /> : <Play size={18} />}
        </button>

        {onZoomOut && (
          <button 
            onClick={onZoomOut} 
            className="transport-btn" 
            title="Zoom out (G)"
          >
            <ZoomOut size={14} />
          </button>
        )}
        {onZoomIn && (
          <button 
            onClick={onZoomIn} 
            className="transport-btn" 
            title="Zoom in (H)"
          >
            <ZoomIn size={14} />
          </button>
        )}
        {onGoToZero && (
          <button 
            onClick={onGoToZero} 
            className="transport-btn" 
            title="Go to zero (playhead to 0)"
          >
            <SkipBack size={14} />
          </button>
        )}
      </div>

      {/* Center: Position Display (Cubase style) */}
      <div className="flex-1 flex justify-center">
        <div className="position-display" title="Current Position">
          {formatPosition(currentBeat, project.timeSignature?.[0] || 4)}
        </div>
      </div>

      {/* Right: Compact BPM - no forced clamp while typing */}
      <div className="flex items-center gap-1.5">
        <div className="bpm-wrapper">
          <span className="bpm-icon">♩</span>
          <input
            type="text"
            inputMode="numeric"
            value={bpmInput}
            onChange={handleBpmChange}
            onBlur={handleBpmBlur}
            className="bpm-input"
            title="Tempo (BPM)"
          />
        </div>

        {/* Quantize dropdown */}
        <div className="flex items-center gap-1 text-[10px] ml-2">
          <span 
            onClick={() => { toggleQuantize() }}
            className={`px-1 py-px text-[10px] font-mono border rounded cursor-pointer select-none transition-all active:scale-95
              ${isQuantizeOn 
                ? 'text-accent border-accent bg-accent/10' 
                : 'text-text-muted border-border bg-bg-elevated'
              }`}
            title="Q 키로 퀀타이즈 ON/OFF (free move) 토글"
          >
            Q
          </span>
          <select
            value={quantize}
            onChange={(e) => setQuantize(parseFloat(e.target.value))}
            className={`bg-bg-elevated border border-border text-accent text-[10px] px-1 py-0.5 rounded focus:outline-none focus:border-accent
              ${!isQuantizeOn ? 'opacity-50' : ''}`}
            title="Quantize step"
          >
            <option value={1/8}>1/32</option>
            <option value={1/4}>1/16</option>
            <option value={0.5}>1/8</option>
            <option value={1}>1/4</option>
            <option value={2}>1/2</option>
          </select>
        </div>

        {/* Loop toggle - L key or button */}
        <div className="flex items-center gap-1 text-[10px] ml-2">
          <button
            onClick={() => { toggleLoop() }}
            className={`px-1.5 py-px text-[10px] font-mono border rounded cursor-pointer select-none transition-all active:scale-95
              ${loopEnabled 
                ? 'text-yellow-400 border-yellow-400 bg-yellow-400/10' 
                : 'text-text-muted border-border bg-bg-elevated'
              }`}
            title="Loop region ON/OFF (L 키)"
          >
            L
          </button>
        </div>

        {/* Metronome */}
        <div className="flex items-center gap-1 text-[10px] ml-2">
          <button
            onClick={() => { toggleMetronome() }}
            className={`px-1.5 py-px text-[10px] font-mono border rounded cursor-pointer select-none transition-all active:scale-95
              ${metronomeEnabled 
                ? 'text-green-400 border-green-400 bg-green-400/10' 
                : 'text-text-muted border-border bg-bg-elevated'
              }`}
            title="Metronome click ON/OFF (synced to BPM)"
          >
            ♩
          </button>
        </div>
      </div>
    </div>
  )
}
