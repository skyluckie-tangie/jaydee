import type { Project } from './types';
import { getSupabase, isSupabaseConfigured } from './supabase';
export { isSupabaseConfigured };

const LOCAL_KEY = 'jaydee:project';
const LOCAL_AUTOSAVE_KEY = 'jaydee:autosave';

export type SaveMode = 'local' | 'cloud';

export function getSaveMode(): SaveMode {
  return isSupabaseConfigured ? 'cloud' : 'local';
}

/** Persist project JSON locally (always available as fallback) */
export function saveProjectLocal(project: Project): void {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(project));
}

export function saveAutosave(project: Project): void {
  localStorage.setItem(LOCAL_AUTOSAVE_KEY, JSON.stringify({ project, savedAt: Date.now() }));
}

export function loadProjectLocal(): Project | null {
  const raw = localStorage.getItem(LOCAL_KEY) || localStorage.getItem(LOCAL_AUTOSAVE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed.project ?? parsed;
  } catch {
    return null;
  }
}

export async function saveProjectCloud(project: Project, userId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase not configured');

  const payload = {
    id: project.id,
    user_id: userId,
    name: project.name,
    data: project,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from('projects').upsert(payload, { onConflict: 'id' });
  if (error) throw error;

  saveProjectLocal(project);
}

export async function loadProjectCloud(projectId: string, userId: string): Promise<Project | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('projects')
    .select('data')
    .eq('id', projectId)
    .eq('user_id', userId)
    .single();

  if (error || !data) return null;
  return data.data as Project;
}

export async function listUserProjects(userId: string): Promise<{ id: string; name: string; updated_at: string }[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('projects')
    .select('id, name, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error || !data) return [];
  return data;
}

export async function saveProject(project: Project, userId?: string | null): Promise<SaveMode> {
  if (isSupabaseConfigured && userId) {
    await saveProjectCloud(project, userId);
    return 'cloud';
  }
  saveProjectLocal(project);
  return 'local';
}

export async function loadProject(projectId?: string, userId?: string | null): Promise<Project | null> {
  if (isSupabaseConfigured && projectId && userId) {
    const cloud = await loadProjectCloud(projectId, userId);
    if (cloud) return cloud;
  }
  return loadProjectLocal();
}

/** ================== Supabase Storage for Audio Assets ================== */

const AUDIO_BUCKET = 'audio_assets';

export async function uploadAudioAsset(file: File, userId: string): Promise<string> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase not configured');

  const ext = file.name.split('.').pop() || 'wav';
  const objectPath = `${userId}/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from(AUDIO_BUCKET)
    .upload(objectPath, file, {
      cacheControl: '3600',
      upsert: false,
    });

  if (error) throw error;
  return objectPath; // e.g. userId/uuid.ext
}

export async function downloadAudioAsset(path: string): Promise<ArrayBuffer> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase not configured');

  const { data, error } = await supabase.storage
    .from(AUDIO_BUCKET)
    .download(path);

  if (error || !data) throw error || new Error('Download failed');
  return await data.arrayBuffer();
}

export function getStoragePathPrefix(userId: string) {
  return `storage:${userId}/`;
}