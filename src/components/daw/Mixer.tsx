import React, { useState, useEffect, useCallback } from 'react'
import { useProjectStore } from '../../stores/useProjectStore'
import { audioEngine } from '../../audio/AudioEngine'
import { X } from 'lucide-react'
import { linearToDb } from '../../audio/utils/gain'



interface MixerProps {
  open: boolean
  onClose: () => void
}

interface MiniSliderProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (val: number) => void
}

// Compact horizontal slider for inline FX params (Cubase-like micro controls)
function MiniSlider({ label, value, min, max, step = 0.1, onChange }: MiniSliderProps) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className="flex items-center gap-1 text-[9px]">
      <span className="w-3 text-[#9ca3af] font-mono select-none">{label}</span>
      <div 
        className="relative flex-1 h-2.5 bg-[#374151] rounded cursor-pointer border border-[#4b5563]"
        onMouseDown={(e) => {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
          const update = (clientX: number) => {
            const p = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
            const newVal = min + p * (max - min)
            onChange(Math.round(newVal / step) * step)
          }
          update(e.clientX)
          const onMove = (me: MouseEvent) => update(me.clientX)
          const onUp = () => {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
          }
          window.addEventListener('mousemove', onMove)
          window.addEventListener('mouseup', onUp, { once: true })
        }}
      >
        <div 
          className="absolute top-0 left-0 h-full bg-[#34d399] rounded" 
          style={{ width: `${pct}%` }} 
        />
      </div>
      <span className="w-7 text-right font-mono text-[#e5e7eb] tabular-nums">{value.toFixed(1)}</span>
    </div>
  )
}

export function Mixer({ open, onClose }: MixerProps) {
  const { 
    project, 
    setTrackGain, 
    setTrackPan, 
    toggleMute, 
    toggleSolo, 
    addInsert, 
    updateInsert, 
    removeInsert, 
    setMasterGain,
    updateTrack,
    reorderInsert,
    loadDemoMixChain
  } = useProjectStore()

  // Local master fader (store setMasterGain only writes to engine, no persisted state)
  const [masterGain, setMasterGainLocal] = useState(0.9)

  // Live meter levels (0-1 peak) polled from engine when open. CSS bars only.
  const [meters, setMeters] = useState<Record<string, number>>({})

  // Inline name editing state
  const [editingTrack, setEditingTrack] = useState<{ id: string; name: string } | null>(null)

  // For master meter
  const masterMeter = meters['master'] ?? 0

  // Poll meters via RAF for smooth visual bars (no store change)
  useEffect(() => {
    if (!open) {
      setMeters({})
      return
    }

    let rafId: number
    const tick = () => {
      const next: Record<string, number> = {}
      project.tracks.forEach((track) => {
        try {
          const m = audioEngine.getTrackMeter(track.id)
          next[track.id] = Math.max(0, Math.min(1, m?.peak ?? 0))
        } catch {
          next[track.id] = 0
        }
      })
      try {
        const mm = audioEngine.getMasterMeter()
        next['master'] = Math.max(0, Math.min(1, mm?.peak ?? 0))
      } catch {
        next['master'] = 0
      }
      setMeters(next)
      rafId = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(rafId)
  }, [open, project.tracks.length]) // length sufficient; meters are live audio driven

  // Vertical fader drag handler (0-2 gain)
  const makeFaderHandlers = useCallback((trackId: string) => {
    return (e: React.MouseEvent<HTMLDivElement>) => {
      const trackEl = e.currentTarget
      const rect = trackEl.getBoundingClientRect()

      const update = (clientY: number) => {
        // Top of fader = max gain (loud), bottom = 0
        const p = 1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
        const gain = Math.max(0, Math.min(2, p * 2))
        setTrackGain(trackId, gain)
      }

      update(e.clientY)

      const onMove = (me: MouseEvent) => update(me.clientY)
      const onUp = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp, { once: true })
    }
  }, [setTrackGain])

  // Pan drag (reuse horizontal pattern from App track list)
  const makePanHandlers = useCallback((trackId: string) => {
    return (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect()
      const update = (clientX: number) => {
        const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
        const pan = (pct - 0.5) * 2
        setTrackPan(trackId, pan)
      }
      update(e.clientX)
      const onMove = (me: MouseEvent) => update(me.clientX)
      const onUp = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp, { once: true })
    }
  }, [setTrackPan])

  const handleMasterFader = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const update = (clientY: number) => {
      const p = 1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
      const g = Math.max(0, Math.min(2, p * 2))
      setMasterGainLocal(g)
      setMasterGain(g)
    }
    update(e.clientY)
    const onMove = (me: MouseEvent) => update(me.clientY)
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp, { once: true })
  }

  // Add inserts using existing store action
  const handleAddInsert = (trackId: string, type: 'eq3band' | 'compressor' | 'filter') => {
    if (type === 'eq3band') {
      addInsert(trackId, {
        type: 'eq3band',
        params: { lowGain: 0, midGain: 0, highGain: 0 }
      })
    } else if (type === 'compressor') {
      addInsert(trackId, {
        type: 'compressor',
        params: { threshold: -24, ratio: 4, attack: 0.003, release: 0.25 }
      })
    } else if (type === 'filter') {
      addInsert(trackId, {
        type: 'filter',
        params: { frequency: 1200, q: 0.7 }
      })
    }
  }

  // Update single param for an insert
  const handleUpdateParam = (trackId: string, insertId: string, key: string, value: number) => {
    updateInsert(trackId, insertId, { [key]: value })
  }

  const handleRemoveInsert = (trackId: string, insertId: string) => {
    removeInsert(trackId, insertId)
  }

  // Name editing (uses updateTrack from store)
  const startEditName = (track: { id: string; name: string }) => {
    setEditingTrack({ id: track.id, name: track.name })
  }

  const commitNameEdit = () => {
    if (!editingTrack) return
    const trimmed = editingTrack.name.trim()
    if (trimmed) {
      updateTrack(editingTrack.id, { name: trimmed })
    }
    setEditingTrack(null)
  }

  const cancelNameEdit = () => setEditingTrack(null)

  if (!open) return null

  const tracks = project.tracks

  return (
    <div 
      className="mixer-panel border-t border-[#334155] bg-[#1f2937] flex flex-col select-none"
      style={{ height: 218, flexShrink: 0 }}
    >
      {/* Mixer header - Cubase dark pro style */}
      <div className="h-7 bg-[#0f172a] border-b border-[#334155] px-3 flex items-center justify-between text-[11px] font-semibold tracking-wide flex-shrink-0">
        <div className="flex items-center gap-2 text-[#e5e7eb]">
          MIXER
          <span className="text-[#64748b] font-normal text-[10px]">{tracks.length} CH • SIGNAL CHAIN</span>
          <button onClick={() => loadDemoMixChain()} className="ml-2 px-1.5 py-px text-[8px] bg-[#374151] hover:bg-[#4b5563] rounded border border-[#4b5563]" title="Load demo insert chains">DEMO CHAIN</button>
          <button 
            onClick={() => useProjectStore.getState().loadDemoMixChain()}
            className="ml-2 px-1.5 py-px text-[8px] bg-[#374151] hover:bg-[#4b5563] rounded border border-[#4b5563]"
            title="Load rich demo insert chains on all tracks"
          >
            DEMO CHAIN
          </button>
        </div>
        <button 
          onClick={onClose} 
          className="text-[#9ca3af] hover:text-white p-0.5"
          title="Close Mixer"
        >
          <X size={14} />
        </button>
      </div>

      {/* Horizontal scrolling channel strips */}
      <div className="flex-1 flex overflow-x-auto overflow-y-hidden p-1.5 gap-1 bg-[#111827]">
        {tracks.map((track) => {
          const gain = Math.max(0, Math.min(2, track.gain))
          const pan = Math.max(-1, Math.min(1, track.pan))
          const meter = meters[track.id] ?? 0
          const isEditing = editingTrack?.id === track.id

          return (
            <div 
              key={track.id} 
              className="channel-strip flex flex-col w-[68px] flex-shrink-0 bg-[#1f2937] border border-[#374151] rounded overflow-hidden"
            >
              {/* Name + M/S header */}
              <div className="px-1 pt-1 pb-0.5 border-b border-[#374151] bg-[#111827]">
                {isEditing ? (
                  <input
                    autoFocus
                    value={editingTrack.name}
                    onChange={(e) => setEditingTrack({ ...editingTrack, name: e.target.value })}
                    onBlur={commitNameEdit}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitNameEdit()
                      if (e.key === 'Escape') cancelNameEdit()
                    }}
                    className="w-full bg-[#374151] text-[10px] px-1 py-0 text-white font-medium outline-none border border-[#34d399]"
                  />
                ) : (
                  <div 
                    className="track-name-mixer text-[10px] font-medium px-0.5 truncate cursor-pointer hover:bg-[#374151] rounded"
                    onDoubleClick={() => startEditName(track)}
                    title="Double-click to rename"
                  >
                    {track.name}
                  </div>
                )}

                <div className="flex items-center justify-between mt-0.5">
                  <div className="ms-group flex gap-px">
                    <div
                      className={`ms-btn m text-[7px] ${track.muted ? 'active' : ''}`}
                      onClick={(e) => { e.stopPropagation(); toggleMute(track.id) }}
                      title="Mute"
                    >
                      M
                    </div>
                    <div
                      className={`ms-btn s text-[7px] ${track.soloed ? 'active' : ''}`}
                      onClick={(e) => { e.stopPropagation(); toggleSolo(track.id) }}
                      title="Solo"
                    >
                      S
                    </div>
                  </div>
                  <div className="text-[8px] text-[#64748b] font-mono tabular-nums pr-0.5">
                    {gainToDb(gain)}
                  </div>
                </div>
              </div>

              {/* Inserts section */}
              <div className="px-1 pt-1 border-b border-[#334155] bg-[#1f2937]">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[#64748b] text-[8px] font-semibold tracking-[0.5px]">INSERTS</span>
                  <div className="flex gap-px">
                    <button
                      onClick={() => handleAddInsert(track.id, 'eq3band')}
                      className="px-1 py-0 text-[8px] bg-[#374151] hover:bg-[#4b5563] border border-[#4b5563] rounded text-[#34d399]"
                      title="Add 3-band EQ"
                    >
                      EQ
                    </button>
                    <button
                      onClick={() => handleAddInsert(track.id, 'compressor')}
                      className="px-1 py-0 text-[8px] bg-[#374151] hover:bg-[#4b5563] border border-[#4b5563] rounded text-[#f59e0b]"
                      title="Add Compressor"
                    >
                      COMP
                    </button>
                    <button
                      onClick={() => {
                        addInsert(track.id, { type: 'filter', params: { frequency: 800, q: 1 } })
                      }}
                      className="px-1 py-0 text-[8px] bg-[#374151] hover:bg-[#4b5563] border border-[#4b5563] rounded text-[#60a5fa]"
                      title="Add Filter (lowpass)"
                    >
                      FILT
                    </button>
                  </div>
                </div>

                {/* Current insert list (slots) */}
                {track.inserts.length > 0 ? (
                  <div className="space-y-px mb-1">
                    {track.inserts.map((ins, idx) => (
                      <div key={ins.id} className="flex items-center gap-1 bg-[#111827] text-[8px] px-1 py-px rounded border border-[#334155]">
                        <span className="flex-1 font-mono truncate text-[#cbd5e1]">{idx + 1}. {ins.type}</span>
                        <button 
                          onClick={() => {
                            const newBypass = !ins.bypass
                            handleUpdateParam(track.id, ins.id, 'bypass', newBypass ? 1 : 0)
                            // trigger rebuild via store (updateInsert already does in impl)
                          }}
                          className={`text-[7px] px-0.5 ${ins.bypass ? 'text-[#f59e0b]' : 'text-[#34d399]'}`}
                          title={ins.bypass ? 'Bypassed - click to enable' : 'Active - click to bypass'}
                        >{ins.bypass ? 'BYP' : 'ON'}</button>
                        <button 
                          onClick={() => useProjectStore.getState().reorderInsert(track.id, idx, Math.max(0, idx-1))}
                          className="text-[#64748b] hover:text-white px-0.5"
                          title="Move up"
                        >↑</button>
                        <button 
                          onClick={() => useProjectStore.getState().reorderInsert(track.id, idx, Math.min(track.inserts.length-1, idx+1))}
                          className="text-[#64748b] hover:text-white px-0.5"
                          title="Move down"
                        >↓</button>
                        <button 
                          onClick={() => handleRemoveInsert(track.id, ins.id)}
                          className="text-[#f87171] hover:text-red-400 leading-none"
                          title="Remove insert"
                        >×</button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[8px] text-[#64748b] mb-1 italic">no inserts</div>
                )}

                {/* Inline param editors for each insert - click-to-edit via sliders */}
                {track.inserts.length > 0 && (
                  <div className="space-y-1 pt-0.5 border-t border-[#334155]">
                    {track.inserts.map((ins) => {
                      if (ins.type === 'eq3band') {
                        const p = ins.params
                        return (
                          <div key={ins.id} className="space-y-px">
                            <div className="text-[#34d399] text-[7px] font-bold">EQ3</div>
                            <MiniSlider 
                              label="L" 
                              value={p.lowGain ?? 0} 
                              min={-12} max={12} step={0.5} 
                              onChange={(v) => handleUpdateParam(track.id, ins.id, 'lowGain', v)} 
                            />
                            <MiniSlider 
                              label="M" 
                              value={p.midGain ?? 0} 
                              min={-12} max={12} step={0.5} 
                              onChange={(v) => handleUpdateParam(track.id, ins.id, 'midGain', v)} 
                            />
                            <MiniSlider 
                              label="H" 
                              value={p.highGain ?? 0} 
                              min={-12} max={12} step={0.5} 
                              onChange={(v) => handleUpdateParam(track.id, ins.id, 'highGain', v)} 
                            />
                          </div>
                        )
                      }
                      if (ins.type === 'compressor') {
                        const p = ins.params
                        return (
                          <div key={ins.id} className="space-y-px">
                            <div className="text-[#f59e0b] text-[7px] font-bold">COMP</div>
                            <MiniSlider 
                              label="Th" 
                              value={p.threshold ?? -24} 
                              min={-60} max={0} step={1} 
                              onChange={(v) => handleUpdateParam(track.id, ins.id, 'threshold', v)} 
                            />
                            <MiniSlider 
                              label="R" 
                              value={p.ratio ?? 4} 
                              min={1} max={20} step={0.5} 
                              onChange={(v) => handleUpdateParam(track.id, ins.id, 'ratio', v)} 
                            />
                          </div>
                        )
                      }
                      if (ins.type === 'filter') {
                        const p = ins.params
                        return (
                          <div key={ins.id} className="space-y-px">
                            <div className="text-[#60a5fa] text-[7px] font-bold">FILT</div>
                            <MiniSlider 
                              label="Hz" 
                              value={p.frequency ?? 1000} 
                              min={20} max={20000} step={10} 
                              onChange={(v) => handleUpdateParam(track.id, ins.id, 'frequency', v)} 
                            />
                            <MiniSlider 
                              label="Q" 
                              value={p.q ?? 1} 
                              min={0.1} max={10} step={0.1} 
                              onChange={(v) => handleUpdateParam(track.id, ins.id, 'q', v)} 
                            />
                          </div>
                        )
                      }
                      return null
                    })}
                  </div>
                )}
              </div>

              {/* Meter + Fader area */}
              <div className="flex-1 flex items-stretch gap-1 px-1 pt-1 bg-[#1f2937] min-h-0">
                {/* Meter - simple CSS bar (pro look) */}
                <div className="w-[9px] flex-shrink-0 relative bg-[#0f172a] border border-[#334155] rounded overflow-hidden self-stretch">
                  <div 
                    className="absolute bottom-0 left-0 right-0 transition-[height] duration-[60ms] ease-linear"
                    style={{ 
                      height: `${meter * 100}%`,
                      background: meter > 0.92 
                        ? 'linear-gradient(to top, #ef4444, #f59e0b, #34d399)' 
                        : meter > 0.7 
                          ? '#f59e0b' 
                          : '#34d399'
                    }}
                  />
                  {/* LED segments for classic look */}
                  {[0.2,0.4,0.6,0.75,0.9].map((th, i) => (
                    <div 
                      key={i}
                      className="absolute left-0 right-0 h-px bg-[#111827]" 
                      style={{ bottom: `${th * 100}%` }}
                    />
                  ))}
                </div>

                {/* Vertical Fader */}
                <div 
                  className="flex-1 relative cursor-pointer bg-[#0f172a] border border-[#334155] rounded active:border-[#34d399]"
                  onMouseDown={makeFaderHandlers(track.id)}
                  title={`Drag vertical fader • ${gainToDb(gain)}`}
                  style={{ minHeight: 92 }}
                >
                  {/* Fader track */}
                  <div className="absolute inset-x-[3px] top-1 bottom-1 bg-[#374151] rounded-sm" />
                  
                  {/* Level fill (follows fader) */}
                  <div 
                    className="absolute bottom-1 left-[3px] right-[3px] bg-gradient-to-t from-[#34d399] to-[#6ee7b7] rounded-sm pointer-events-none" 
                    style={{ height: `${(gain / 2) * 100}%` }} 
                  />

                  {/* Knob */}
                  <div 
                    className="absolute left-1/2 -translate-x-1/2 w-[15px] h-[9px] bg-[#e5e7eb] border border-[#334155] rounded shadow pointer-events-none"
                    style={{ 
                      bottom: `calc(${(gain / 2) * 100}% + 1px)`,
                      transform: 'translate(-50%, 50%)'
                    }}
                  >
                    <div className="absolute inset-x-0 top-1/2 h-px bg-[#111827]" />
                  </div>
                </div>
              </div>

              {/* Pan control (bottom) */}
              <div className="px-1 pb-1 pt-0.5">
                <div className="text-[8px] text-[#64748b] flex justify-between mb-px px-0.5">
                  <span>L</span>
                  <span className="font-mono">{pan.toFixed(2)}</span>
                  <span>R</span>
                </div>
                <div 
                  className="track-pan h-[3px] bg-[#374151] relative rounded cursor-pointer"
                  onMouseDown={makePanHandlers(track.id)}
                >
                  <div 
                    className="absolute top-1/2 -translate-y-1/2 w-0.5 h-[7px] bg-[#34d399] rounded" 
                    style={{ left: `${(pan + 1) * 50}%` }} 
                  />
                </div>
              </div>
            </div>
          )
        })}

        {/* MASTER SECTION - always last */}
        <div className="channel-strip master-strip flex flex-col w-[74px] flex-shrink-0 bg-[#111827] border-2 border-[#475569] rounded overflow-hidden ml-1">
          <div className="px-1 pt-1 pb-0.5 border-b border-[#475569] bg-[#0f172a]">
            <div className="text-[#cbd5e1] text-[11px] font-bold tracking-wider">MASTER</div>
            <div className="text-[8px] text-[#64748b] font-mono tabular-nums">{gainToDb(masterGain)}</div>
          </div>

          <div className="flex-1 flex items-stretch gap-1 px-1 pt-1 min-h-0">
            {/* Master meter */}
            <div className="w-[9px] flex-shrink-0 relative bg-[#0f172a] border border-[#475569] rounded overflow-hidden">
              <div 
                className="absolute bottom-0 left-0 right-0 transition-[height] duration-[60ms]"
                style={{ 
                  height: `${masterMeter * 100}%`,
                  background: masterMeter > 0.92 
                    ? 'linear-gradient(to top, #ef4444 0%, #f59e0b 50%, #34d399 100%)' 
                    : masterMeter > 0.7 ? '#f59e0b' : '#34d399'
                }}
              />
              {[0.25,0.5,0.75,0.92].map((th, i) => (
                <div key={i} className="absolute left-0 right-0 h-px bg-[#1f2937]" style={{ bottom: `${th*100}%` }} />
              ))}
            </div>

            {/* Master vertical fader */}
            <div 
              className="flex-1 relative cursor-pointer bg-[#0f172a] border border-[#475569] rounded active:border-[#34d399]"
              onMouseDown={handleMasterFader}
              title={`Master fader • ${gainToDb(masterGain)}`}
              style={{ minHeight: 92 }}
            >
              <div className="absolute inset-x-[3px] top-1 bottom-1 bg-[#334155] rounded-sm" />
              <div 
                className="absolute bottom-1 left-[3px] right-[3px] bg-gradient-to-t from-[#a3a3ac] to-[#e5e7eb] rounded-sm pointer-events-none" 
                style={{ height: `${(masterGain / 2) * 100}%` }} 
              />
              <div 
                className="absolute left-1/2 -translate-x-1/2 w-[15px] h-[9px] bg-white border-2 border-[#334155] rounded shadow pointer-events-none"
                style={{ bottom: `calc(${(masterGain / 2) * 100}% + 1px)`, transform: 'translate(-50%, 50%)' }}
              >
                <div className="absolute inset-x-0 top-1/2 h-px bg-[#111827]" />
              </div>
            </div>
          </div>

          <div className="px-1 pb-1 pt-0.5 text-[8px] text-center text-[#64748b] font-semibold tracking-widest">OUT</div>
        </div>
      </div>

      <div className="h-4 text-[9px] px-2 text-[#64748b] flex items-center border-t border-[#334155] bg-[#111827] flex-shrink-0">
        Drag faders vertically • M/S wired to store • Inline sliders update inserts live
      </div>
    </div>
  )
}

// Use shared util
const gainToDb = linearToDb

export default Mixer
