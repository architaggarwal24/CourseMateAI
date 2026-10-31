import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import HistoryPanel from "@/components/HistoryPanel";
import HistoryView from "@/components/HistoryView";
import { saveMetadata } from "@/lib/sessions";
import { formatWhen } from "./sessionMeta";

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const seed = () => saveMetadata({
  c1: { type: "chat", preview: "What is ATP?", updated: hoursAgo(1), title: "bio.pdf" } as any,
  q1: { type: "quiz", preview: "cells · 3/5 answered", updated: hoursAgo(30) },
  n1: { type: "notes", preview: "key concepts · Normal", updated: hoursAgo(24 * 40) },
  f1: { type: "flashcards", preview: "cells · 1/10", updated: hoursAgo(50) },
  a1: { type: "arena", preview: "boss fight", updated: hoursAgo(2) },
});
beforeEach(() => { localStorage.clear(); seed(); });
afterEach(cleanup);

describe("formatWhen", () => {
  const now = new Date(2026, 9, 14, 20, 30);                              // Oct 14 2026, 8:30 PM local
  it("says today, yesterday, then the date (with the year only when it is another year)", () => {
    expect(formatWhen(new Date(2026, 9, 14, 8, 11).toISOString(), now).text).toMatch(/^Today, /);
    expect(formatWhen(new Date(2026, 9, 13, 23, 5).toISOString(), now).text).toMatch(/^Yesterday, /);
    expect(formatWhen(new Date(2026, 8, 2, 9, 0).toISOString(), now).text).toMatch(/^Sep 2, /);
    expect(formatWhen(new Date(2025, 11, 31, 9, 0).toISOString(), now).text).toMatch(/^Dec 31, 2025, /);
    expect(formatWhen("not a date", now)).toEqual({ text: "Unknown date", full: "Unknown date" });
  });
});

describe("HistoryView", () => {
  it("lists each session with its mode icon and label, a clear date, and leaves out arena sessions", () => {
    render(<HistoryView />);
    const items = within(screen.getByRole("list", { name: "Sessions" })).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(items[0].textContent).toContain("Chat");                       // newest first
    expect(items[0].textContent).toContain("bio.pdf");
    expect(items[0].textContent).toMatch(/Today, /);
    expect(items.map((li) => li.querySelector("svg")).every(Boolean)).toBe(true);
    expect(within(items[0]).getByText(/Today, /).closest("time")!.getAttribute("datetime")).toBeTruthy();
    expect(screen.queryByText("boss fight")).toBeNull();
    expect(screen.getByText("4 sessions")).toBeTruthy();
  });

  it("filters by mode with the tabs and by text with the search, and says when nothing matches", () => {
    render(<HistoryView />);
    fireEvent.click(screen.getByRole("tab", { name: "Quiz 1" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("cells · 3/5 answered")).toBeTruthy();
    expect(screen.queryByText("What is ATP?")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "All" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search sessions" }), { target: { value: "zzz" } });
    expect(screen.getByText("No sessions match your search")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByText("What is ATP?")).toBeTruthy();
  });

  it("opens a session in its own tool, and deletes one", () => {
    vi.useFakeTimers();
    const onNavigate = vi.fn();
    render(<HistoryView onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: /Flashcards[\s\S]*cells · 1\/10/ }));
    expect(onNavigate).toHaveBeenCalledWith("flashcards", "f1");

    fireEvent.click(screen.getByRole("button", { name: "Delete quiz session" }));
    act(() => { vi.advanceTimersByTime(250); });
    vi.useRealTimers();
    expect(screen.queryByText("cells · 3/5 answered")).toBeNull();
  });

  it("shows a calm empty state when there is no history", () => {
    localStorage.clear();
    render(<HistoryView />);
    expect(screen.getByText("No sessions yet")).toBeTruthy();
    expect(screen.getByText("Sessions are saved automatically as you study.")).toBeTruthy();
  });
});

describe("HistoryPanel", () => {
  it("starts on the tool's own tab, lists its sessions with icon, label and date, and switches tabs", () => {
    render(<HistoryPanel activeMode="notes" onSelect={vi.fn()} onNew={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("tab", { name: "Notes" }).getAttribute("aria-selected")).toBe("true");
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("key concepts · Normal");
    expect(rows[0].querySelector("svg")).toBeTruthy();
    expect(rows[0].querySelector("time")!.textContent).toMatch(/^[A-Z][a-z]{2} \d{1,2}, /);   // 40 days ago: a calendar date
    fireEvent.click(screen.getByRole("tab", { name: "All" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });

  it("selects, creates and closes", () => {
    const onSelect = vi.fn(), onNew = vi.fn(), onClose = vi.fn();
    render(<HistoryPanel activeMode="chat" onSelect={onSelect} onNew={onNew} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /What is ATP\?/ }));
    expect(onSelect).toHaveBeenCalledWith("c1", "chat");
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    fireEvent.click(screen.getByRole("button", { name: "Close history" }));
    expect(onNew).toHaveBeenCalled(); expect(onClose).toHaveBeenCalled();
  });

  it("shows the empty state for a mode with no sessions", () => {
    localStorage.clear();
    render(<HistoryPanel onSelect={vi.fn()} onNew={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("No history yet")).toBeTruthy();
  });
});
