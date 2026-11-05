// The desktop sidebar: expanded (labels, groups, courses) or collapsed to a 64px icon rail. The state lives on
// <html data-sidebar> so CSS lays the page out before React runs (SIDEBAR_SCRIPT, in <head>), and in localStorage
// "cmai_sidebar" once the user has chosen. Without a choice, screens narrower than 1280px (tablets) start collapsed.

const KEY = "cmai_sidebar";
export const SIDEBAR_EVENT = "cmai:sidebar";

export function isSidebarCollapsed(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset.sidebar === "collapsed";
}

export function setSidebarCollapsed(collapsed: boolean): boolean {
  document.documentElement.dataset.sidebar = collapsed ? "collapsed" : "expanded";
  try { localStorage.setItem(KEY, collapsed ? "collapsed" : "expanded"); } catch { /* private mode: still applies */ }
  window.dispatchEvent(new Event(SIDEBAR_EVENT));
  return collapsed;
}

export const toggleSidebar = (): boolean => setSidebarCollapsed(!isSidebarCollapsed());

export const SIDEBAR_SCRIPT = `(function(){var h=document.documentElement;try{var s=localStorage.getItem('${KEY}');h.dataset.sidebar=s==='collapsed'||s==='expanded'?s:(window.innerWidth<1280?'collapsed':'expanded');}catch(e){h.dataset.sidebar='expanded';}})();`;
