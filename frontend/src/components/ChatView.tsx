"use client";

import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { ArrowDown, ArrowUp, Check, Copy, FileText, History, Lightbulb, ListChecks, MessageSquare, Plus, Sparkles, Trash2 } from "lucide-react";
import { motion } from "motion/react";
import { Spotlight, TextReveal } from "@/components/fx";
import HistoryPanel from "./HistoryPanel";
import ChatMarkdown from "./chat/ChatMarkdown";
import NotFoundCard from "./chat/NotFoundCard";
import SourceChips from "./chat/SourceChips";
import { Button, ErrorState, Textarea } from "@/components/ui";
import { askChat, isAbortError } from "@/lib/chatStream";
import { useDocument } from "@/hooks/useSessions";
import { useHUDStore } from "@/hooks/useHUD";
import { useStickToBottom } from "@/hooks/useStickToBottom";
import { saveSession, loadSession } from "@/lib/sessions";
import { toast } from "@/components/ui/Toast";

interface Message {
  role: "user" | "assistant";
  content: string;
  /** Where the answer came from ("file.pdf · p.4"). */
  sources?: string[];
  /** The document doesn't cover the question this answers: shown as the calm "couldn't find that" state. */
  notFound?: { question: string };
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

const QUICK_PROMPTS = [
  "Summarize the key concepts",
  "What are the main topics covered?",
  "Explain the most important points",
  "Give me a study guide from this",
];

const MAX_INPUT_PX = 160;

/** `documentId` is the workspace's active document (what the questions are about); `chatId` is just this saved chat. */
export default function ChatView({ documentId, restoreSessionId }: { documentId?: string; restoreSessionId?: string }) {
  const [chatId, setChatId] = useState(() => restoreSessionId || crypto.randomUUID());
  const sessionId = documentId ?? chatId;
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
  const { document: pdf } = useDocument(documentId);
  const uploadedFile = pdf?.status === "ready" ? pdf.filename : null;   // what the server says is usable
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [followUps, setFollowUps] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  /** The last question failed: shown under the conversation (not part of it, never saved) with the button its code calls for. */
  /** What a screen reader hears about the answer: one short line when it starts and when it is complete (not every token). */
  const [announcement, setAnnouncement] = useState("");
  const [failure, setFailure] = useState<{ error: unknown; question: string } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const refreshIfStale = useHUDStore((s) => s.refreshIfStale);
  const scroll = useStickToBottom<HTMLDivElement>();

  // Leaving the screen cancels the request in flight (the server stops the model and records nothing).
  useEffect(() => () => requestRef.current?.abort(), []);

  // Keep the newest text in view - only while the reader is at the bottom.
  useLayoutEffect(() => { scroll.follow(); }, [messages, followUps, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save whenever messages change
  useEffect(() => {
    if (messages.length > 0 && !loading) {
      const withType = messages.map((m) => ({ ...m, type: "chat" }));
      saveSession(chatId, withType as any);
    }
  }, [messages, chatId, loading]);

  // The input grows with what is typed, up to a few lines, then scrolls.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_PX)}px`;
  }, [input]);

  const cancelRequest = useCallback(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    setLoading(false);
  }, []);

  const startNewSession = useCallback(() => {
    cancelRequest();
    setChatId(crypto.randomUUID());
    setMessages([]);
    setFollowUps([]);
    setFailure(null);
    setInput("");
  }, [cancelRequest]);

  const loadHistorySession = useCallback((id: string, _type: string) => {
    cancelRequest();
    const loaded = loadSession(id);
    // loadSession may return an object (saved via saveSessionData) or an array — handle both
    const raw = Array.isArray(loaded) ? loaded : [];
    const msgs = raw.filter((m) => m.role === "user" || m.role === "assistant") as Message[];
    setChatId(id);
    setMessages(msgs);
    setFollowUps([]);
    setFailure(null);
    setShowHistory(false);
  }, [cancelRequest]);

  /** `base` is the conversation the question is added to (a retry passes the one without the failed question). */
  const sendMessage = useCallback(async (question: string, base: Message[] = messages) => {
    if (!question.trim() || loading) return;
    setFollowUps([]);
    setFailure(null);
    setLoading(true);
    setAnnouncement("The assistant is answering.");
    scroll.jump();                                          // sending is asking to see the answer

    const history = base.map((m) => ({ role: m.role, content: m.content }));
    // The answer starts as an empty message that fills in as the text arrives.
    setMessages([...base, { role: "user", content: question }, { role: "assistant", content: "" }]);
    const patchAnswer = (patch: (m: Message) => Message) =>
      setMessages((prev) => (prev.length ? [...prev.slice(0, -1), patch(prev[prev.length - 1])] : prev));

    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const answer = await askChat({
        question, sessionId, history, signal: controller.signal,
        onToken: (text) => patchAnswer((m) => ({ ...m, content: m.content + text })),
        onFallback: () => patchAnswer((m) => ({ ...m, content: "" })),     // the stream failed: the full answer follows
      });
      const { main, followUps: parsed } = parseFollowUps(answer.content || "No response received");
      patchAnswer(() => answer.blocked
        ? { role: "assistant", content: answer.content, notFound: { question } }
        : { role: "assistant", content: main, sources: answer.sources });
      if (parsed.length > 0 && !answer.blocked) setFollowUps(parsed);
      setAnnouncement(answer.blocked ? "The document doesn't cover that question." : "Answer complete.");
      refreshIfStale(5_000);
      if (answer.rewards?.ok) {
        toast.success(`+${answer.rewards.xp_gained} XP | +${answer.rewards.coins_gained} Coins`, { icon: "🎉" });
        if (answer.rewards.new_achievements?.length) {
          for (const ach of answer.rewards.new_achievements) {
            toast.success(`🏆 Achievement Unlocked: ${ach.name}`, { description: ach.description, duration: 5000 });
          }
        }
      }
    } catch (e) {
      if (isAbortError(e) || controller.signal.aborted) return;   // the user left / started over: nothing to show
      setMessages((prev) => prev.slice(0, -1));                   // the empty (or half-written) answer goes; the question stays
      setFailure({ error: e, question });
      setAnnouncement("");                                        // the error below announces itself (role="alert")
    } finally {
      if (requestRef.current === controller) { requestRef.current = null; setLoading(false); }
    }
  }, [loading, messages, sessionId, refreshIfStale, scroll]);

  /** Ask the failed question again (the conversation without it, so it isn't in the history twice). */
  const retryFailed = () => {
    if (!failure) return;
    const base = messages[messages.length - 1]?.role === "user" ? messages.slice(0, -1) : messages;
    void sendMessage(failure.question, base);
  };

  const handleSend = () => {
    const q = input.trim();
    if (!q || loading) return;
    setInput("");
    void sendMessage(q);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter makes a new line. (Enter that confirms an IME composition is not a send.)
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  const copyToClipboard = async (text: string, index: number) => {
    await navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const clearChat = () => {
    cancelRequest();
    setMessages([]);
    setFollowUps([]);
    setFailure(null);
    toast.info("Chat cleared");
  };

  const last = messages[messages.length - 1];
  const waitingForFirstToken = loading && last?.role === "assistant" && last.content === "";

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

      <div className="ws-pane flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Toolbar */}
        <div className="ws-toolbar">
          <div className="min-w-0">
            <h2>Chat</h2>
            <p>
              {messages.length > 0
                ? `${Math.floor(messages.length / 2)} exchanges · memory active`
                : uploadedFile ? `Ask anything about ${uploadedFile}` : "Ask questions about your document"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" icon pressed={showHistory} onClick={() => setShowHistory((v) => !v)} aria-label="Session history" title="Session history">
              <History size={16} />
            </Button>
            <Button size="sm" icon onClick={startNewSession} aria-label="New chat" title="New chat">
              <Plus size={16} />
            </Button>
            {messages.length > 0 && (
              <Button size="sm" icon variant="danger" onClick={clearChat} aria-label="Clear chat" title="Clear chat">
                <Trash2 size={16} />
              </Button>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="relative flex-1 min-h-0">
          <div ref={scroll.ref} onScroll={scroll.onScroll} data-testid="chat-scroll"
               className="h-full overflow-y-auto chat-scroll px-6 py-6">
            <div className="mx-auto w-full max-w-[72ch] space-y-6" role="log" aria-live="polite" aria-busy={loading || undefined} aria-label="Conversation">
              {messages.length === 0 && (
                <div className="py-12 text-center">
                  <span className="study-intro__icon mx-auto mb-6" aria-hidden="true"><MessageSquare size={26} /></span>
                  <TextReveal as="h3" className="block text-3xl font-bold tracking-tight text-gradient mb-2" text="Chat with your document" />
                  <p className="text-fg-muted mb-8">
                    {uploadedFile ? `Chatting with ${uploadedFile}. Ask anything about it.` : "Upload a PDF first, then ask questions — answers come straight from your document."}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
                    {QUICK_PROMPTS.map((p, i) => {
                      const PromptIcon = [Lightbulb, ListChecks, FileText, MessageSquare][i % 4];
                      return (
                      <motion.div key={p} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                                  transition={{ delay: 0.25 + i * 0.06, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}>
                        <Spotlight className="rounded-[var(--radius-lg)]">
                          <button onClick={() => void sendMessage(p)} className="study-prompt">
                            <PromptIcon size={16} aria-hidden="true" />{p}
                          </button>
                        </Spotlight>
                      </motion.div>
                      );
                    })}
                  </div>
                </div>
              )}

              {messages.map((msg, idx) => {
                if (msg.role === "user") {
                  return (
                    <motion.article key={idx} aria-label="You" className="flex justify-end"
                      initial={{ opacity: 0, y: 14, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ type: "spring", stiffness: 380, damping: 30 }} style={{ transformOrigin: "100% 100%" }}>
                      <p className="chat-user max-w-[85%] whitespace-pre-wrap break-words">
                        {msg.content}
                      </p>
                    </motion.article>
                  );
                }
                const isStreaming = loading && idx === messages.length - 1;
                if (waitingForFirstToken && idx === messages.length - 1) {
                  return (
                    <div key={idx} className="chat-ai" aria-busy="true">
                      <span className="chat-ai__avatar" aria-hidden="true"><Sparkles size={15} /></span>
                      <div role="status" aria-label="Waiting for the answer" className="chat-typing w-fit">
                        <span className="loading-dot" /><span className="loading-dot" /><span className="loading-dot" />
                      </div>
                    </div>
                  );
                }
                if (msg.notFound) {
                  return <NotFoundCard key={idx} question={msg.notFound.question} onAsk={(q) => void sendMessage(q)} />;
                }
                const shown = parseFollowUps(msg.content).main;     // the "explore further" block is not part of the answer
                return (
                  <motion.article key={idx} aria-label="Assistant" aria-busy={isStreaming || undefined} className="chat-ai"
                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}>
                    <span className="chat-ai__avatar" aria-hidden="true"><Sparkles size={15} /></span>
                    <div className="chat-ai__body">
                      <ChatMarkdown>{shown}</ChatMarkdown>
                      {!isStreaming && <SourceChips sources={msg.sources} />}
                      {!isStreaming && (
                        <div className="chat-ai__actions">
                          <Button variant="ghost" size="sm" onClick={() => void copyToClipboard(msg.content, idx)}>
                            {copiedIndex === idx ? <><Check size={13} aria-hidden="true" /> Copied</> : <><Copy size={13} aria-hidden="true" /> Copy</>}
                          </Button>
                        </div>
                      )}
                    </div>
                  </motion.article>
                );
              })}

              {failure && <ErrorState error={failure.error} onRetry={retryFailed} />}

              {!loading && followUps.length > 0 && (
                <motion.div className="flex flex-col gap-2 pl-11" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
                  <p className="study-suggest-label !mb-1">Explore further</p>
                  <div className="flex flex-wrap gap-2">
                    {followUps.map((q, i) => (
                      <Button key={i} size="sm" className="text-left" onClick={() => { setFollowUps([]); void sendMessage(q); }}>
                        {q}
                      </Button>
                    ))}
                  </div>
                </motion.div>
              )}
            </div>
          </div>

          {scroll.away && (
            <Button size="sm" onClick={scroll.jump} aria-label="Jump to latest"
                    className="absolute bottom-3 left-1/2 -translate-x-1/2">
              <ArrowDown size={14} aria-hidden="true" /> Latest
            </Button>
          )}
        </div>

        <p className="sr-only" role="status">{announcement}</p>

        {/* Input: pinned below the scrolling list */}
        <div className="ws-composer-bar">
          <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="study-composer mx-auto w-full max-w-[72ch]">
            <Textarea
              ref={inputRef}
              rows={1}
              aria-label="Message"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={messages.length > 0 ? "Ask a follow-up question…" : "Ask a question about your PDF…"}
              hint={undefined}
              wrapperClassName="flex-1"
              className="resize-none"
              style={{ maxHeight: MAX_INPUT_PX }}
            />
            <Button type="submit" variant="primary" icon disabled={!input.trim() || loading} loading={loading} aria-label="Send">
              {!loading && <ArrowUp size={18} strokeWidth={2.5} />}
            </Button>
          </form>
          <p className="mx-auto mt-2 w-full max-w-[72ch] text-center text-xs text-fg-muted"><kbd className="kbd">Enter</kbd> to send · <kbd className="kbd">Shift</kbd>+<kbd className="kbd">Enter</kbd> new line</p>
        </div>
      </div>
    </div>
  );
}
