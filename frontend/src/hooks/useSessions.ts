import { create } from "zustand";
import {
  loadMetadata,
  saveSession,
  loadSession,
  deleteSession as delSession,
} from "@/lib/sessions";
import { Message, SessionMeta } from "@/types";

interface SessionStore {
  activeIds: Record<string, string>;
  messages: Record<string, Message[]>;
  getActiveId: (mode: string) => string;
  setActiveId: (mode: string, id: string) => void;
  newSession: (mode: string) => string;
  getMessages: (sessionId: string, type: string) => Message[];
  addMessage: (sessionId: string, msg: Message) => void;
  setMessages: (sessionId: string, msgs: Message[]) => void;
  saveCurrentSession: (sessionId: string) => void;
  deleteSession: (sessionId: string, mode: string) => void;
  getSessions: (type: string) => [string, SessionMeta][];
}

function modeToType(mode: string): string {
  switch (mode) {
    case "chat":
      return "chat";
    case "quiz":
      return "quiz";
    case "notes":
      return "notes";
    case "arena":
      return "battle";
    default:
      return "chat";
  }
}

export const useSessionStore = create<SessionStore>()((set, get) => ({
  activeIds: {},
  messages: {},

  getActiveId: (mode: string) => {
    const ids = get().activeIds;
    if (!ids[mode]) {
      const id = crypto.randomUUID();
      set({ activeIds: { ...ids, [mode]: id } });
      return id;
    }
    return ids[mode];
  },

  setActiveId: (mode: string, id: string) => {
    set({ activeIds: { ...get().activeIds, [mode]: id } });
  },

  newSession: (mode: string) => {
    const id = crypto.randomUUID();
    const type = modeToType(mode);
    const msgs: Message[] = [{ role: "system", content: "", type }];
    set({
      activeIds: { ...get().activeIds, [mode]: id },
      messages: { ...get().messages, [id]: msgs },
    });
    if (typeof window !== "undefined") {
      saveSession(id, msgs);
    }
    return id;
  },

  getMessages: (sessionId: string, type: string) => {
    const allMsgs = get().messages;
    if (!allMsgs[sessionId]) {
      if (typeof window === "undefined") {
        const initial: Message[] = [{ role: "system", content: "", type }];
        return initial;
      }
      const loaded = loadSession(sessionId);
      if (loaded.length === 0) {
        const initial: Message[] = [{ role: "system", content: "", type }];
        set({ messages: { ...allMsgs, [sessionId]: initial } });
        return initial;
      }
      set({ messages: { ...allMsgs, [sessionId]: loaded } });
      return loaded;
    }
    return allMsgs[sessionId];
  },

  addMessage: (sessionId: string, msg: Message) => {
    const allMsgs = { ...get().messages };
    if (!allMsgs[sessionId]) allMsgs[sessionId] = [];
    
    // Make sure message has type
    const messageWithType = {
      ...msg,
      type: msg.type || allMsgs[sessionId][0]?.type || "chat"
    };
    
    allMsgs[sessionId] = [...allMsgs[sessionId], messageWithType];
    set({ messages: allMsgs });
    
    if (typeof window !== "undefined") {
      saveSession(sessionId, allMsgs[sessionId]);
    }
  },

  setMessages: (sessionId: string, msgs: Message[]) => {
    const allMsgs = { ...get().messages };
    allMsgs[sessionId] = msgs;
    set({ messages: allMsgs });
    if (typeof window !== "undefined") {
      saveSession(sessionId, msgs);
    }
  },

  saveCurrentSession: (sessionId: string) => {
    const msgs = get().messages[sessionId];
    if (msgs && typeof window !== "undefined") {
      saveSession(sessionId, msgs);
    }
  },

  deleteSession: (sessionId: string, mode: string) => {
    if (typeof window !== "undefined") {
      delSession(sessionId);
    }
    
    const allMsgs = { ...get().messages };
    delete allMsgs[sessionId];
    
    // Create new session and set it as active
    const newId = crypto.randomUUID();
    const type = modeToType(mode);
    allMsgs[newId] = [{ role: "system", content: "", type }];
    
    set({
      messages: allMsgs,
      activeIds: { ...get().activeIds, [mode]: newId },
    });
    
    if (typeof window !== "undefined") {
      saveSession(newId, allMsgs[newId]);
    }
  },

  getSessions: (type: string) => {
    if (typeof window === "undefined") return [];
    const meta = loadMetadata();
    return Object.entries(meta)
      .filter(([, m]) => m.type === type)
      .sort(
        ([, a], [, b]) =>
          new Date(b.updated).getTime() - new Date(a.updated).getTime()
      );
  },
}));