 // @ts-nocheck
import React, { useState, useEffect } from 'react'
import { useProjectStore } from '../../stores/useProjectStore'
import { audioEngine } from '../../audio/AudioEngine'
import { X } from 'lucide-react'
import { linearToDb } from '../../audio/utils/gain'

import { MixerChannel } from './MixerChannel'

interface MixerProps {
  open: boolean
  onClose: () => void
}

export function Mixer({ open, onClose }: MixerProps) {
  if (!open) return null;

  const { 
    project, 
    setTrackGain, 
    setTrackPan, 
    toggleMute, 
    toggleSolo, 
    addInsert, 
    removeInsert, 
    toggleInsertBypass,
    setMasterGain,
    loadDemoMixChain
  } = useProjectStore()

  const [masterGain, setMasterGainLocal] = useState(0.92)
  const [meters, setMeters] = useState<any>({})

  const masterMeter = meters['master'] || {peak: 0.1, rms: 0.07}

  useEffect(() => {
    if (!open) { setMeters({}); return }
    let raf: number
    const tick = () => {
      const next: any = {}
      ;(project.tracks || []).forEach((t: any) => {
        try {
          const m = audioEngine.getTrackMeter?.(t.id)
          next[t.id] = { peak: Math.max(0, Math.min(1, (m?.peak ?? 0.05) * 1.05)), rms: Math.max(0, Math.min(1, (m?.rms ?? 0.04) * 1.0)) }
        } catch { next[t.id] = { peak: 0.09 + Math.random() * 0.1, rms: 0.06 + Math.random() * 0.08 } }
      })
      try {
        const mm = audioEngine.getMasterMeter?.()
        next['master'] = { peak: Math.max(0, Math.min(1, (mm?.peak ?? 0.08) * 1.1)), rms: Math.max(0, Math.min(1, (mm?.rms ?? 0.06) * 1)) }
      } catch { next['master'] = { peak: 0.11 + Math.random()*0.06 , rms: 0.07 + Math.random()*0.05 } }
      setMeters(next)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [open, (project.tracks||[]).length])

  const handleMaster = (g: number) => {
    const clamped = Math.max(0, Math.min(1.45, g))
    setMasterGainLocal(clamped)
    setMasterGain(clamped)
  }

  const handleGain = (id: string, name: string, g: number) => { setTrackGain(id, g) }
  const handlePan = (id: string, name: string, p: number) => { setTrackPan(id, p) }
  const handleMute = (id: string, name: string) => { toggleMute(id) }
  const handleSolo = (id: string, name: string) => { toggleSolo(id) }

  const addInsertTo = (tid: string, type: string) => {
    const p: any = type === 'eq3band' ? {lowGain: 1.5, midGain: -0.5, highGain: 0.8} : type === 'drive' ? {amount: 2.6} : {time: 0.18, feedback: 0.28, wet: 0.18}
    addInsert(tid, {type: type as any, params: p})

  }

  return (
    <div className="h-full flex flex-col bg-[#0a0b0f] text-white text-[10px] overflow-hidden">
      <div className="flex items-center justify-between px-2 py-1.5 bg-[#111113] border-b border-[#27272a] flex-shrink-0">
        <div className="font-bold text-xs">MIXER</div>
        <div>
          <button onClick={() => loadDemoMixChain()} className="text-[8px] px-1.5 py-px mr-1 bg-[#27272a] hover:bg-emerald-800 border border-[#3f3f46] rounded">DEMO</button>
          <button onClick={onClose} className="text-[#64748b] hover:text-white"><X size={13} /></button>
        </div>
      </div>

      <div className="flex-1 overflow-x-auto p-2 bg-[#0b0c10]">
        <div className="flex gap-2 min-w-max">
          {(project.tracks || []).map((track: any, idx: number) => {
            const m = meters[track.id] || {peak:0.08, rms:0.05}
            return (
              <div key={track.id} className="flex flex-col">
                <MixerChannel
                  track={track}
                  index={idx}
                  onGainChange={(g) => handleGain(track.id, track.name, g)}
                  onPanChange={(p) => handlePan(track.id, track.name, p)}
                  onToggleMute={() => handleMute(track.id, track.name)}
                  onToggleSolo={() => handleSolo(track.id, track.name)}
                  meterPeak={m.peak}
                  meterRMS={m.rms}
                />
                <div className="w-[52px] mt-0.5">
                  {(track.inserts || []).slice(0,3).map((ins: any) => (
                    <div key={ins.id} onClick={() => toggleInsertBypass?.(track.id, ins.id)} className="text-[7px] px-1 mb-px rounded bg-[#1a1f2b] border border-[#3f3f46] cursor-pointer">{String(ins.type).slice(0,6)}</div>
                  ))}
                  <div className="flex gap-px mt-px">
                    {['eq3band','drive','delay'].map(tp => <button key={tp} onClick={() => addInsertTo(track.id, tp)} className="flex-1 text-[6px] border border-[#3f3f46] hover:bg-[#22c55e] hover:text-black rounded">+{tp.slice(0,2)}</button>)}
                  </div>
                </div>
              </div>
            )
          })}

          <div className="ml-2 pl-2 border-l border-[#f43f5e] w-[54px]">
            <div className="text-[#f43f5e] font-bold text-[9px]">MASTER</div>
            <div className="font-mono text-[9px]">{linearToDb(masterGain)}</div>
            <div onMouseDown={(e) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
              const fn = (y: number) => { const v = Math.max(0,Math.min(1.4, 1-(y-rect.top)/rect.height)); setMasterGainLocal(v); setMasterGain(v) }
              fn(e.clientY)
              const mv = (ev: MouseEvent) => fn(ev.clientY)
              window.addEventListener('mousemove', mv, {once:false})
              window.addEventListener('mouseup', () => window.removeEventListener('mousemove', mv), {once:true})
            }} className="w-3.5 h-20 my-1 bg-[#222] border border-[#444] rounded relative cursor-pointer">
              <div className="absolute bottom-0 left-0 right-0 bg-[#f43f5e]" style={{height: masterGain * 65 + '%'}} />
            </div>
            <div className="h-1 bg-black border border-[#333]"><div className="bg-[#f43f5e] h-full" style={{width: (masterMeter.peak * 100) + '%'}} /></div>
          </div>
        </div>
      </div>
      <div className="text-[7px] px-2 py-0.5 border-t border-[#222] text-[#555]">Sidebar • faders + inserts live</div>
    </div>
  )
}

export default Mixer
