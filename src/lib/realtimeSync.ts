import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase, isSupabaseConfigured } from './supabase';

export type ClipMoveEvent = {
  type: 'clip_move';
  trackId: string;
  clipId: string;
  newStartBeat: number;
  userId: string;
  ts: number;
};

export type RealtimeHandler = (event: ClipMoveEvent) => void;

let channel: RealtimeChannel | null = null;

export function subscribeToProject(projectId: string, userId: string, onEvent: RealtimeHandler): () => void {
  if (!isSupabaseConfigured) return () => {};

  const supabase = getSupabase();
  if (!supabase) return () => {};

  const room = `jaydee:${projectId}`;
  channel?.unsubscribe();

  channel = supabase.channel(room, {
    config: { broadcast: { self: false } },
  });

  channel.on('broadcast', { event: 'clip_move' }, (payload) => {
    const evt = payload.payload as ClipMoveEvent;
    if (evt.userId === userId) return;
    onEvent(evt);
  });

  channel.subscribe();

  return () => {
    channel?.unsubscribe();
    channel = null;
  };
}

export async function broadcastClipMove(
  _projectId: string,
  userId: string,
  trackId: string,
  clipId: string,
  newStartBeat: number,
): Promise<void> {
  if (!isSupabaseConfigured || !channel) return;

  const evt: ClipMoveEvent = {
    type: 'clip_move',
    trackId,
    clipId,
    newStartBeat,
    userId,
    ts: Date.now(),
  };

  await channel.send({ type: 'broadcast', event: 'clip_move', payload: evt });
}