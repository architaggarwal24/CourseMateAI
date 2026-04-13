"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { Send, Copy, Check, Sparkles, BookOpen, Trash2, History, Plus } from "lucide-react";
import FileUploader from "./FileUploader";
import HistoryPanel from "./HistoryPanel";
import { chatQuestion } from "@/lib/api";
import { useHUDStore } from "@/hooks/useHUD";
import { saveSession, loadSession } from "@/lib/sessions";
import { toast } from "sonner";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github-dark.css";

interface Message {
  role: "user" | "assistant";
  content: string;
}

function parseFollowUps(content: string): { main: string; followUps: string[] } {
  const parts = content.split("\n---\n");
  if (parts.length < 2) return { main: content, followUps: [] };
  const main = parts.slice(0, -1).join("\n---\n").trim();
  const last = parts[parts.length - 1];
  const followUps: string[] = [];
  for (const line of last.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("- ") && trimmed.length > 10) {
      const q = trimmed.slice(2).replace(/^\[/, "").replace(/\]$/, "").trim();
      if (q.length > 5) followUps.push(q);
    }
  }
  return { main, followUps };
}

export default function ChatView({ restoreSessionId }: { restoreSessionId?: string }) {
  const [sessionId, setSessionId] = useState(() => restoreSessionId || crypto.randomUUID());
  const [messages, setMessages] = useState<Message[]>(() => {
    if (restoreSessionId) {
      try {
        const saved = loadSession(restoreSessionId);
        const msgs = Array.isArray(saved) ? saved : [];
        return msgs.filter((m: any) => m.role === "user" || m.role === "assistant") as Message[];
      } catch { return []; }
    }
    return [];
  });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [followUps, setFollowUps] = useState<string[]>([]);
  const [uploadedFile, setUploadedFile] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const { refresh, refreshIfStale } = useHUDStore((s) => ({ refresh: s.refresh, refreshIfStale: s.refreshIfStale }));

  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [messages, followUps]);

  // Auto-save whenever messages change
  useEffect(() => {
    if (messages.length > 0) {
      const withType = messages.map((m) => ({ ...m, type: "chat" }));
      saveSession(sessionId, withType as any);
    }
  }, [messages, sessionId]);

  const startNewSession = useCallback(() => {
    setSessionId(crypto.randomUUID());
    setMessages([]);
    setFollowUps([]);
    setInput("");
  }, []);

  const loadHistorySession = useCallback((id: string, _type: string) => {
    const loaded = loadSession(id);
    // loadSession may return an object (saved via saveSessionData) or an array — handle both
    const raw = Array.isArray(loaded) ? loaded : [];
    const msgs = raw.filter((m) => m.role === "user" || m.role === "assistant") as Message[];
    setSessionId(id);
    setMessages(msgs);
    setFollowUps([]);
    setShowHistory(false);
  }, []);

  const sendMessage = useCallback(async (question: string) => {
    if (!question.trim() || loading) return;
    setFollowUps([]);
    setLoading(true);

    const newUserMsg: Message = { role: "user", content: question };
    const updatedMessages = [...messages, newUserMsg];
    setMessages(updatedMessages);

    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    let data;
    try {
      data = await chatQuestion(question, sessionId, 5, history);
    } catch (e: any) {
      // FIX BUG 46: If chatQuestion throws, setLoading(true) was never cleared.
      // The loading spinner would stay forever. Catch here and reset state.
      setLoading(false);
      const errMsg = e?.message || "Request failed. Please try again.";
      setMessages((prev) => [
        ...prev,
        { role: "assistant" as const, content: `⚠️ ${errMsg}` },
      ]);
      return;
    }

    if (data) {
      const raw = data.content || "No response received";
      const { main, followUps: parsed } = parseFollowUps(raw);
      setMessages((prev) => [...prev, { role: "assistant", content: main }]);
      if (parsed.length > 0) setFollowUps(parsed);
      refreshIfStale(5_000);
      if (data.rewards?.ok) {
        toast.success(`+${data.rewards.xp_gained} XP | +${data.rewards.coins_gained} Coins`, { icon: "🎉" });
        if (data.rewards.new_achievements?.length) {
          for (const ach of data.rewards.new_achievements) {
            toast.success(`🏆 Achievement Unlocked: ${ach.name}`, { description: ach.description, duration: 5000 });
          }
        }
      }
    } else {
      setMessages((prev) => [...prev, { role: "assistant", content: "Failed to get response from server." }]);
    }
    setLoading(false);
  }, [loading, messages, sessionId, refresh]);

  const handleSend = () => {
    const q = input.trim();
    if (!q) return;
    setInput("");
    sendMessage(q);
  };

  const copyToClipboard = async (text: string, index: number) => {
    await navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const clearChat = () => {
    setMessages([]);
    setFollowUps([]);
    toast.info("Chat cleared");
  };

  const quickPrompts = [
    { text: "Summarize the key concepts", icon: "📋" },
    { text: "What are the main topics covered?", icon: "📚" },
    { text: "Explain the most important points", icon: "💡" },
    { text: "Give me a study guide from this", icon: "✏️" },
  ];

  return (
    <div className="flex h-full overflow-hidden">
      {/* History panel */}
      {showHistory && (
        <HistoryPanel
          activeMode="chat"
          onSelect={loadHistorySession}
          onNew={() => { startNewSession(); setShowHistory(false); }}
          onClose={() => setShowHistory(false)}
        />
      )}

      <div className="flex flex-col flex-1 overflow-hidden bg-bg-primary">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle bg-bg-secondary/50 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-accent-blue/10 border border-accent-blue/20">
              <Sparkles size={18} className="text-accent-blue" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">Chat with PDF</h2>
              <p className="text-xs text-text-muted">
                {messages.length > 0 ? `${Math.floor(messages.length / 2)} exchanges · memory active` : "Ask questions about your document"}
              </p>
              {uploadedFile && (
                <p className="text-xs text-green-400 flex items-center gap-1 mt-0.5">
                  <span>📄</span> {uploadedFile} — answers grounded in your PDF
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowHistory((v) => !v)}
              className={`p-2 rounded-lg border transition-all ${showHistory ? "border-accent-blue text-accent-blue bg-accent-blue/10" : "border-border text-text-muted hover:border-accent-blue/50 hover:text-accent-blue"}`}
              title="Session history"
            >
              <History size={16} />
            </button>
            <button
              onClick={startNewSession}
              className="p-2 rounded-lg border border-border text-text-muted hover:border-accent-gold/50 hover:text-accent-gold transition-all"
              title="New chat"
            >
              <Plus size={16} />
            </button>
            {messages.length > 0 && (
              <button
                onClick={clearChat}
                className="p-2 rounded-lg border border-border hover:border-accent-red/50 text-text-muted hover:text-accent-red transition-all"
                title="Clear chat"
              >
                <Trash2 size={16} />
              </button>
            )}
            <FileUploader sessionId={sessionId} onUploadSuccess={setUploadedFile} />
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollContainerRef} className="flex-1 overflow-auto chat-scroll px-6 py-6 space-y-6">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-2xl mx-auto">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-accent-blue/20 to-accent-purple/20 flex items-center justify-center mb-6">
                <BookOpen size={40} className="text-accent-blue" />
              </div>
              <h3 className="text-2xl font-bold text-text-primary mb-3">Chat with Your PDF</h3>
              <p className="text-text-muted mb-6 max-w-md">
                {uploadedFile ? `Chatting with ${uploadedFile}. Ask anything about the document.` : "Upload a PDF first, then ask questions — answers come straight from your document."}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full max-w-2xl text-left">
                {quickPrompts.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => sendMessage(p.text)}
                    className="flex items-center gap-3 p-3 rounded-xl border border-border bg-bg-card hover:border-accent-blue/40 hover:bg-accent-blue/5 transition-all text-left"
                  >
                    <span className="text-xl">{p.icon}</span>
                    <span className="text-sm text-text-secondary">{p.text}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, idx) => (
            <div key={idx} className={`flex gap-4 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              {msg.role === "assistant" && (
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-blue to-accent-purple flex items-center justify-center flex-shrink-0">
                  <Sparkles size={16} className="text-white" />
                </div>
              )}
              <div className={`max-w-[75%] rounded-2xl px-5 py-4 ${
                msg.role === "user"
                  ? "bg-gradient-to-br from-accent-gold/20 to-accent-gold/10 border border-accent-gold/30"
                  : "bg-bg-card border border-border"
              }`}>
                {msg.role === "assistant" ? (
                  <div className="prose prose-invert prose-sm max-w-none prose-headings:text-text-primary prose-p:text-text-secondary prose-strong:text-text-primary prose-code:text-accent-gold prose-code:bg-bg-primary prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-bg-primary prose-pre:border prose-pre:border-border">
                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex, rehypeHighlight]}>
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-text-primary">{msg.content}</p>
                )}
                {msg.role === "assistant" && (
                  <button
                    onClick={() => copyToClipboard(msg.content, idx)}
                    className="mt-3 text-xs text-text-muted hover:text-accent-gold transition-colors flex items-center gap-1"
                  >
                    {copiedIndex === idx ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
                  </button>
                )}
              </div>
              {msg.role === "user" && (
                <div className="w-8 h-8 rounded-lg bg-accent-gold/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-semibold text-accent-gold">You</span>
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex gap-4 justify-start">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-blue to-accent-purple flex items-center justify-center flex-shrink-0">
                <Sparkles size={16} className="text-white" />
              </div>
              <div className="bg-bg-card border border-border rounded-2xl px-5 py-4 flex items-center gap-1.5">
                <span className="loading-dot w-2 h-2 rounded-full bg-accent-blue inline-block" />
                <span className="loading-dot w-2 h-2 rounded-full bg-accent-blue inline-block" />
                <span className="loading-dot w-2 h-2 rounded-full bg-accent-blue inline-block" />
              </div>
            </div>
          )}

          {!loading && followUps.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-text-muted pl-12">💡 Explore further:</p>
              <div className="flex flex-wrap gap-2 pl-12">
                {followUps.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => { setFollowUps([]); sendMessage(q); }}
                    className="text-xs px-3 py-2 rounded-lg border border-accent-blue/30 bg-accent-blue/5 text-accent-blue hover:bg-accent-blue/15 hover:border-accent-blue/60 transition-all text-left"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div ref={endRef} />
        </div>

        {/* Input */}
        <div className="px-6 py-4 border-t border-border-subtle bg-bg-secondary/50 backdrop-blur-sm">
          <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="flex gap-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={messages.length > 0 ? "Ask a follow-up question..." : "Ask a question about your PDF..."}
              className="flex-1 px-4 py-3 bg-bg-card border border-border rounded-xl text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-gold/50"
              disabled={loading}
            />
            <button
              type="submit"
              disabled={!input.trim() || loading}
              className="px-6 py-3 bg-gradient-to-r from-accent-blue to-accent-purple text-white rounded-xl font-semibold hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {loading ? (
                <span className="w-5 h-5 rounded-full border-2 border-white border-t-transparent inline-block" style={{ animation: 'spin 0.7s linear infinite' }} />
              ) : <Send size={20} />}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}