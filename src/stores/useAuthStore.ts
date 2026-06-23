import { create } from 'zustand';
import { getSupabase, isSupabaseConfigured } from '../lib/supabase';
import type { User, Session } from '@supabase/supabase-js';

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  initialized: boolean;
  isCloudEnabled: boolean;

  initialize: () => Promise<void>;
  signInAnonymously: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, _get) => ({
  user: null,
  session: null,
  loading: false,
  initialized: false,
  isCloudEnabled: isSupabaseConfigured,

  initialize: async () => {
    if (!isSupabaseConfigured) {
      set({ initialized: true });
      return;
    }

    const supabase = getSupabase();
    if (!supabase) {
      set({ initialized: true });
      return;
    }

    const { data } = await supabase.auth.getSession();
    set({
      session: data.session,
      user: data.session?.user ?? null,
      initialized: true,
    });

    supabase.auth.onAuthStateChange((_event, session) => {
      set({ session, user: session?.user ?? null });
    });
  },

  signInAnonymously: async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    set({ loading: true });
    try {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
      set({ user: data.user, session: data.session });
    } finally {
      set({ loading: false });
    }
  },

  signInWithEmail: async (email, password) => {
    const supabase = getSupabase();
    if (!supabase) return;
    set({ loading: true });
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      set({ user: data.user, session: data.session });
    } finally {
      set({ loading: false });
    }
  },

  signUpWithEmail: async (email, password) => {
    const supabase = getSupabase();
    if (!supabase) return;
    set({ loading: true });
    try {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      set({ user: data.user, session: data.session });
    } finally {
      set({ loading: false });
    }
  },

  signOut: async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    await supabase.auth.signOut();
    set({ user: null, session: null });
  },
}));