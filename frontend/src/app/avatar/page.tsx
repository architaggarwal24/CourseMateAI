"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useHUDStore } from "@/hooks/useHUD";
import { useRouter } from "next/navigation";
import { ArrowLeft, ShoppingBag, Package, Sparkles, Swords, Shield, Crown, PawPrint, X, Zap, ChevronRight } from "lucide-react";
import AvatarDisplay from "@/components/AvatarDisplay";
import HomeButton from "@/components/HomeButton";
import PixelSprite from "@/components/PixelSprite";
import { toast } from "sonner";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ── Animated count-up ────────────────────────────────────────────────────────
function useCountUp(target: number, delay = 300) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => {
      let frame = 0;
      const total = 60;
      const tick = () => {
        frame++;
        const p = frame / total;
        const ease = 1 - Math.pow(1 - p, 3);
        setV(Math.round(target * ease));
        if (frame < total) requestAnimationFrame(tick);
        else setV(target);
      };
      requestAnimationFrame(tick);
    }, delay);
    return () => clearTimeout(t);
  }, [target, delay]);
  return v;
}

// ── Slot config ───────────────────────────────────────────────────────────────
const SLOTS = [
  { key: "headgear", label: "HEADGEAR", Icon: Crown,    accent: "#F59E0B", shadow: "#F59E0B44" },
  { key: "armor",    label: "ARMOR",    Icon: Shield,   accent: "#3B82F6", shadow: "#3B82F644" },
  { key: "weapon",   label: "WEAPON",   Icon: Swords,   accent: "#EF4444", shadow: "#EF444444" },
  { key: "pet",      label: "PET",      Icon: PawPrint, accent: "#10B981", shadow: "#10B98144" },
];

export default function AvatarPage() {
  const { user } = useAuth();
  const router   = useRouter();
  const level    = useHUDStore(s => s.level);
  const xp       = useHUDStore(s => s.xp);
  const coins    = useHUDStore(s => s.coins);
  const xpInto   = useHUDStore(s => s.xpInto);
  const xpToNext = useHUDStore(s => s.xpToNext);

  const [shopData,   setShopData]   = useState<any>(null);
  const [loading,    setLoading]    = useState(true);
  const [activeSlot, setActiveSlot] = useState<string | null>(null);
  const [previewId,  setPreviewId]  = useState<string | null>(null);
  const [entered,    setEntered]    = useState(false);

  const xpCounted    = useCountUp(xp,    500);
  const coinCounted  = useCountUp(coins, 600);
  const xpPct        = Math.min(100, Math.round((xpInto / Math.max(xpToNext, 1)) * 100));

  useEffect(() => { loadProfile(); }, []);
  useEffect(() => { if (!loading) setTimeout(() => setEntered(true), 80); }, [loading]);

  const loadProfile = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/shop`, { credentials: "include" });
      if (r.ok) setShopData(await r.json());
    } catch {}
    setLoading(false);
  };

  const handleEquip = async (itemId: string, name: string) => {
    try {
      const r = await fetch(`${API}/shop/equip`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: "ignored", item_id: itemId }),
      });
      if (r.ok) { toast.success(`${name} equipped!`); setPreviewId(null); await loadProfile(); }
      else toast.error("Equip failed");
    } catch { toast.error("Equip failed"); }
  };

  const handleUnequip = async (slot: string) => {
    try {
      const r = await fetch(`${API}/shop/unequip`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: "ignored", slot }),
      });
      if (r.ok) { toast.success("Unequipped"); setActiveSlot(null); await loadProfile(); }
    } catch {}
  };

  if (loading || !shopData) return (
    <div className="av-loading">
      <div className="av-spinner" />
      <p className="av-loading-txt">SUMMONING HERO</p>
      <style>{styles}</style>
    </div>
  );

  const equipped      = shopData.equipped || {};
  const ownedItems    = shopData.items.filter((i: any) => i.owned && !i.consumable);
  const equippedCount = Object.values(equipped).filter(Boolean).length;

  const previewEquipped = (() => {
    if (!previewId) return equipped;
    const it = shopData.items.find((i: any) => i.id === previewId);
    return it ? { ...equipped, [it.category]: previewId } : equipped;
  })();

  const activeBonuses: { label: string; val: string; clr: string }[] = [];
  Object.values(equipped).forEach((id: any) => {
    const it = shopData.items.find((i: any) => i.id === id);
    if (!it?.bonus) return;
    const b = it.bonus;
    if (b.xp_pct)       activeBonuses.push({ label: "XP",    val: `+${Math.round(b.xp_pct*100)}%`,       clr: "#60A5FA" });
    if (b.coin_pct)     activeBonuses.push({ label: "COINS", val: `+${Math.round(b.coin_pct*100)}%`,     clr: "#F59E0B" });
    if (b.combo_xp_pct) activeBonuses.push({ label: "COMBO", val: `+${Math.round(b.combo_xp_pct*100)}%`, clr: "#A78BFA" });
    if (b.arena_hints)  activeBonuses.push({ label: "HINTS", val: `+${b.arena_hints}`,                   clr: "#F87171" });
  });

  return (
    <div className="av-root">
      <style>{styles}</style>

      {/* ── topbar ─────────────────────────────────────── */}
      <header className="av-topbar">
        <button className="av-back" onClick={() => router.back()}>
          <ArrowLeft size={16} />
        </button>
        <HomeButton />
      </header>

      {/* ══════════════════════════════════════════════════
          HERO SHOWCASE — full-bleed cinematic left panel
      ══════════════════════════════════════════════════ */}
      <div className="av-layout">

        {/* LEFT: Avatar Stage */}
        <section className={`av-stage ${entered ? "av-stage--in" : ""}`}>

          {/* Aurora background layers */}
          <div className="av-aurora av-aurora-1" />
          <div className="av-aurora av-aurora-2" />
          <div className="av-aurora av-aurora-3" />

          {/* Grid lines */}
          <div className="av-grid" />

          {/* Ground beam */}
          <div className="av-beam" />

          {/* ── Avatar ─────────────────────────────── */}
          <div className="av-hero-wrap">
            <div className="av-hero-glow" />
            <div className="av-hero-figure">
              <AvatarDisplay equipped={previewEquipped} items={shopData.items} size="xl" />
            </div>
          </div>

          {/* ── Identity ───────────────────────────── */}
          <div className="av-identity">
            <div className="av-level-badge">LV {level}</div>
            <h1 className="av-name">{user?.username?.toUpperCase() || "HERO"}</h1>
            <p className="av-title">{equipped.title || "Aspiring Champion"}</p>
            {equippedCount >= 4 && (
              <div className="av-full-kit">⚔ FULL KIT</div>
            )}
          </div>

          {/* ── XP progress arc ────────────────────── */}
          <div className="av-xp-strip">
            <div className="av-xp-label">
              <span>NEXT LEVEL</span>
              <span className="av-xp-pct">{xpPct}%</span>
            </div>
            <div className="av-xp-track">
              <div className="av-xp-fill" style={{ "--pct": `${xpPct}%` } as any} />
              <div className="av-xp-spark" style={{ "--pct": `${xpPct}%` } as any} />
            </div>
            <div className="av-xp-nums">
              <span>{xpInto.toLocaleString()} XP</span>
              <span>{xpToNext.toLocaleString()} to go</span>
            </div>
          </div>
        </section>

        {/* RIGHT: Stats + Equipment */}
        <aside className={`av-panel ${entered ? "av-panel--in" : ""}`}>

          {/* ── Stats row ──────────────────────────── */}
          <div className="av-stats">
            {[
              { label: "TOTAL XP",  val: xpCounted.toLocaleString(),  clr: "#60A5FA", icon: "⚡" },
              { label: "COINS",     val: coinCounted.toLocaleString(), clr: "#F59E0B", icon: "🪙" },
              { label: "OWNED",     val: ownedItems.length,            clr: "#A78BFA", icon: "📦" },
              { label: "EQUIPPED",  val: `${equippedCount}/4`,         clr: "#10B981", icon: "🛡" },
            ].map(({ label, val, clr, icon }) => (
              <div key={label} className="av-stat" style={{ "--clr": clr } as any}>
                <div className="av-stat-icon">{icon}</div>
                <div className="av-stat-val">{val}</div>
                <div className="av-stat-label">{label}</div>
              </div>
            ))}
          </div>

          {/* ── Active bonuses ─────────────────────── */}
          {activeBonuses.length > 0 && (
            <div className="av-bonuses">
              <div className="av-bonuses-title"><Zap size={11} color="#F59E0B" /> ACTIVE BONUSES</div>
              <div className="av-bonuses-list">
                {activeBonuses.map((b, i) => (
                  <div key={i} className="av-bonus-chip" style={{ "--clr": b.clr } as any}>
                    <span>{b.label}</span>
                    <strong>{b.val}</strong>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Action buttons ─────────────────────── */}
          <div className="av-actions">
            <button className="av-btn av-btn--forge" onClick={() => router.push("/avatar/hero-forge")}>
              <Sparkles size={14} />
              HERO FORGE
              <ChevronRight size={14} />
            </button>
            <div className="av-btn-row">
              <button className="av-btn av-btn--shop" onClick={() => router.push("/shop")}>
                <ShoppingBag size={13} /> SHOP
              </button>
              <button className="av-btn av-btn--inv" onClick={() => router.push("/inventory")}>
                <Package size={13} /> INVENTORY
              </button>
            </div>
          </div>

          {/* ── Equipment section ──────────────────── */}
          <div className="av-eq-section">
            <div className="av-section-title">
              <div className="av-section-line" />
              EQUIPMENT
              <div className="av-section-line" />
            </div>

            <div className="av-eq-grid">
              {SLOTS.map(({ key, label, Icon, accent, shadow }) => {
                const eqItem   = shopData.items.find((i: any) => i.id === equipped[key]);
                const slotItms = ownedItems.filter((i: any) => i.category === key);
                const isOpen   = activeSlot === key;

                return (
                  <div key={key} className={`av-eq-card ${isOpen ? "av-eq-card--open" : ""}`}
                    style={{ "--accent": accent, "--shadow": shadow } as any}>

                    {/* Card header */}
                    <button className="av-eq-head" onClick={() => setActiveSlot(isOpen ? null : key)}>
                      <div className="av-eq-icon-wrap">
                        <Icon size={14} />
                      </div>
                      <div className="av-eq-info">
                        <span className="av-eq-slot-name">{label}</span>
                        {eqItem
                          ? <span className="av-eq-item-name">{eqItem.name}</span>
                          : <span className="av-eq-empty">— empty —</span>}
                        {eqItem?.bonus && (() => {
                          const b = eqItem.bonus;
                          const parts: string[] = [];
                          if (b.xp_pct) parts.push(`+${Math.round(b.xp_pct*100)}% XP`);
                          if (b.coin_pct) parts.push(`+${Math.round(b.coin_pct*100)}% coins`);
                          return parts.length
                            ? <span className="av-eq-bonus">{parts.join(" · ")}</span>
                            : null;
                        })()}
                      </div>
                      <div className="av-eq-sprite-wrap">
                        {eqItem && <PixelSprite itemId={eqItem.id} size="sm" />}
                      </div>
                      <div className={`av-eq-chevron ${isOpen ? "av-eq-chevron--open" : ""}`}>▼</div>
                    </button>

                    {/* Dropdown picker */}
                    {isOpen && (
                      <div className="av-eq-drawer">
                        {eqItem && (
                          <button className="av-unequip" onClick={() => handleUnequip(key)}>
                            <X size={10} /> Unequip
                          </button>
                        )}
                        {slotItms.length === 0 ? (
                          <div className="av-eq-empty-state">
                            <p>No {label.toLowerCase()} owned</p>
                            <button onClick={() => router.push("/shop")}>Visit Shop →</button>
                          </div>
                        ) : (
                          <div className="av-item-grid">
                            {slotItms.map((item: any) => {
                              const isEq = item.id === equipped[key];
                              const isPv = item.id === previewId;
                              return (
                                <button key={item.id}
                                  className={`av-item-btn ${isEq ? "av-item-btn--eq" : ""} ${isPv ? "av-item-btn--pv" : ""}`}
                                  style={{ "--accent": accent } as any}
                                  onMouseEnter={() => setPreviewId(item.id)}
                                  onMouseLeave={() => setPreviewId(null)}
                                  onClick={() => isEq ? handleUnequip(key) : handleEquip(item.id, item.name)}
                                  title={item.name}>
                                  {isEq && <div className="av-item-check">✓</div>}
                                  <PixelSprite itemId={item.id} size="sm" />
                                  <span className="av-item-name">{item.name}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {previewId && (
              <p className="av-preview-hint">● Previewing on your hero</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');

  @keyframes spin     { to { transform: rotate(360deg); } }
  @keyframes float    { 0%,100%{ transform: translateY(0) scale(1.55); } 50%{ transform: translateY(-12px) scale(1.55); } }
  @keyframes beam-pulse { 0%,100%{opacity:.3} 50%{opacity:.7} }
  @keyframes glow-pulse { 0%,100%{opacity:.4;transform:scale(.95)} 50%{opacity:.9;transform:scale(1.05)} }
  @keyframes aurora-1 { 0%,100%{transform:translate(0,0) scale(1);opacity:.5} 33%{transform:translate(60px,-40px) scale(1.1);opacity:.8} 66%{transform:translate(-30px,20px) scale(.95);opacity:.4} }
  @keyframes aurora-2 { 0%,100%{transform:translate(0,0) scale(1);opacity:.4} 50%{transform:translate(-80px,50px) scale(1.15);opacity:.7} }
  @keyframes aurora-3 { 0%,100%{transform:translate(0,0);opacity:.3} 40%{transform:translate(40px,-60px) scale(1.1);opacity:.6} 80%{transform:translate(-20px,30px);opacity:.25} }
  @keyframes stage-in { from{opacity:0;transform:translateX(-40px)} to{opacity:1;transform:translateX(0)} }
  @keyframes panel-in { from{opacity:0;transform:translateX(40px)} to{opacity:1;transform:translateX(0)} }
  @keyframes bar-grow { from{width:0} to{width:var(--pct)} }
  @keyframes spark-move { from{left:0} to{left:var(--pct)} }
  @keyframes shimmer  { 0%{background-position:-200%} 100%{background-position:200%} }
  @keyframes name-in  { from{opacity:0;letter-spacing:8px} to{opacity:1;letter-spacing:4px} }
  @keyframes pop-in   { from{opacity:0;transform:scale(.7)} to{opacity:1;transform:scale(1)} }

  .av-root { min-height:100vh; background:#040408; color:#E8E8F0; overflow-x:hidden; }

  /* loading */
  .av-loading { display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#040408;gap:24px; }
  .av-spinner { width:56px;height:56px;border:3px solid #F59E0B;border-top-color:transparent;border-radius:50%;animation:spin .8s linear infinite; }
  .av-loading-txt { font-family:'Press Start 2P',monospace;font-size:9px;color:#2A1A4A;letter-spacing:3px; }

  /* topbar */
  .av-topbar { position:sticky;top:0;z-index:100;display:flex;align-items:center;justify-content:space-between;padding:10px 20px;background:rgba(4,4,8,.95);border-bottom:1px solid #0E0E1E;backdrop-filter:blur(20px); }
  .av-back   { display:flex;align-items:center;gap:6px;background:none;border:none;color:#444;cursor:pointer;padding:6px 10px;border-radius:8px;transition:color .15s;font-size:13px; }
  .av-back:hover { color:#DDD; }

  /* layout */
  .av-layout { display:flex;flex-direction:column;min-height:calc(100vh - 49px); }
  @media(min-width:900px) { .av-layout { flex-direction:row; } }

  /* ── STAGE ── */
  .av-stage {
    position:relative; flex:0 0 auto;
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    gap:0; padding:40px 20px 32px;
    background:#06040E;
    overflow:hidden; min-height:520px;
    opacity:0;
  }
  .av-stage--in { animation: stage-in .7s cubic-bezier(.4,0,.2,1) both; }
  @media(min-width:900px) { .av-stage { width:440px; min-height:calc(100vh - 49px); } }

  /* aurora layers */
  .av-aurora { position:absolute;border-radius:50%;filter:blur(80px);pointer-events:none; }
  .av-aurora-1 { width:400px;height:400px;top:-80px;left:-60px;background:radial-gradient(circle,#4C1D9566 0%,transparent 70%);animation:aurora-1 8s ease-in-out infinite; }
  .av-aurora-2 { width:350px;height:350px;bottom:-60px;right:-80px;background:radial-gradient(circle,#065F4666 0%,transparent 70%);animation:aurora-2 10s ease-in-out infinite; }
  .av-aurora-3 { width:300px;height:300px;top:50%;left:50%;margin:-150px 0 0 -150px;background:radial-gradient(circle,#1E3A5F55 0%,transparent 70%);animation:aurora-3 7s ease-in-out infinite; }

  /* grid texture */
  .av-grid { position:absolute;inset:0;opacity:.04;pointer-events:none;
    background-image:linear-gradient(#FFFFFF11 1px,transparent 1px),linear-gradient(90deg,#FFFFFF11 1px,transparent 1px);
    background-size:40px 40px; }

  /* ground beam */
  .av-beam {
    position:absolute; bottom:0; left:50%; transform:translateX(-50%);
    width:200px; height:340px;
    background:linear-gradient(to top,#7C3AED33 0%,transparent 100%);
    filter:blur(30px); pointer-events:none;
    animation:beam-pulse 3s ease-in-out infinite;
  }

  /* hero */
  .av-hero-wrap { position:relative; display:flex; align-items:center; justify-content:center; z-index:2; }
  .av-hero-glow {
    position:absolute; width:260px; height:260px; border-radius:50%;
    background:radial-gradient(circle,#7C3AED22 0%,transparent 70%);
    filter:blur(20px); pointer-events:none;
    animation:glow-pulse 3s ease-in-out infinite;
  }
  .av-hero-figure { animation:float 4s ease-in-out infinite; position:relative; z-index:2; }

  /* identity */
  .av-identity { z-index:2; text-align:center; margin-top:20px; }
  .av-level-badge {
    display:inline-block; font-family:'Press Start 2P',monospace; font-size:8px;
    color:#A78BFA; background:#150A30; border:1px solid #4C1D95;
    border-radius:6px; padding:4px 10px; margin-bottom:10px;
  }
  .av-name {
    font-family:'Press Start 2P',monospace; font-size:18px; letter-spacing:4px;
    background:linear-gradient(135deg,#FFFFFF,#C4B5FD,#FFFFFF);
    -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text;
    margin:0 0 8px; text-shadow:none;
    animation:name-in .8s ease both .3s;
  }
  .av-title { font-family:'Press Start 2P',monospace; font-size:7px; color:#F59E0B; opacity:.8; letter-spacing:2px; margin:0 0 10px; }
  .av-full-kit {
    display:inline-block; font-family:'Press Start 2P',monospace; font-size:6px;
    color:#FFD700; background:#1C1300; border:1px solid #7C6000; border-radius:5px;
    padding:3px 10px; animation:pop-in .4s ease both;
  }

  /* xp strip */
  .av-xp-strip { z-index:2; width:100%; max-width:320px; margin-top:20px; }
  .av-xp-label { display:flex;justify-content:space-between;font-family:'Press Start 2P',monospace;font-size:6px;color:#3A2A60;margin-bottom:6px; }
  .av-xp-pct   { color:#A78BFA; }
  .av-xp-track { height:10px;border-radius:5px;background:#08061A;border:1px solid #1A1040;overflow:hidden;position:relative; }
  .av-xp-fill  {
    position:absolute;top:0;left:0;height:100%;border-radius:inherit;
    background:linear-gradient(90deg,#4C1D95,#7C3AED,#F59E0B,#FCD34D);
    box-shadow:0 0 12px #7C3AED66;
    width:var(--pct); animation:bar-grow 1.5s cubic-bezier(.4,0,.2,1) both .4s;
  }
  .av-xp-spark {
    position:absolute;top:1px;bottom:1px;width:8px;border-radius:4px;
    background:rgba(255,255,255,.5);filter:blur(2px);
    left:var(--pct);margin-left:-8px;
    animation:spark-move 1.5s cubic-bezier(.4,0,.2,1) both .4s;
  }
  .av-xp-nums { display:flex;justify-content:space-between;font-family:'Press Start 2P',monospace;font-size:5px;color:#2A1A50;margin-top:5px; }

  /* ── PANEL ── */
  .av-panel {
    flex:1; padding:24px 20px 40px;
    display:flex; flex-direction:column; gap:18px;
    opacity:0; overflow-y:auto;
  }
  .av-panel--in { animation: panel-in .7s cubic-bezier(.4,0,.2,1) both .15s; }

  /* stats */
  .av-stats { display:grid;grid-template-columns:1fr 1fr;gap:10px; }
  .av-stat  {
    background:#08080F; border:1px solid var(--clr, #333)22;
    border-radius:12px; padding:14px 10px; text-align:center;
    transition:transform .2s,box-shadow .2s;
    box-shadow:0 0 0 transparent;
  }
  .av-stat:hover { transform:translateY(-3px); box-shadow:0 8px 24px var(--clr,#333)22; }
  .av-stat-icon  { font-size:20px; margin-bottom:6px; }
  .av-stat-val   { font-family:'Press Start 2P',monospace;font-size:12px;color:var(--clr,#FFF);margin-bottom:4px;text-shadow:0 0 16px var(--clr,#FFF)44; }
  .av-stat-label { font-family:'Press Start 2P',monospace;font-size:6px;color:#1E1A30; }

  /* bonuses */
  .av-bonuses       { background:#070610;border:1px solid #1A1530;border-radius:12px;padding:12px 14px; }
  .av-bonuses-title { display:flex;align-items:center;gap:6px;font-family:'Press Start 2P',monospace;font-size:7px;color:#F59E0B;margin-bottom:10px; }
  .av-bonuses-list  { display:flex;flex-wrap:wrap;gap:6px; }
  .av-bonus-chip    {
    font-family:'Press Start 2P',monospace;font-size:6px;
    color:var(--clr,#FFF); background:var(--clr,#FFF)12; border:1px solid var(--clr,#FFF)25;
    border-radius:6px;padding:4px 9px;display:flex;gap:5px;
  }
  .av-bonus-chip strong { color:#FFF; }

  /* actions */
  .av-actions { display:flex;flex-direction:column;gap:8px; }
  .av-btn     { display:flex;align-items:center;justify-content:center;gap:8px;padding:12px 16px;border-radius:10px;font-family:'Press Start 2P',monospace;font-size:8px;cursor:pointer;border:none;transition:all .15s; }
  .av-btn--forge {
    background:linear-gradient(135deg,#4C1D95,#7C3AED);
    color:#fff; box-shadow:0 4px 20px #7C3AED44;
    position:relative;overflow:hidden;
  }
  .av-btn--forge::after {
    content:'';position:absolute;inset:0;
    background:linear-gradient(90deg,transparent,rgba(255,255,255,.12),transparent);
    background-size:200%;animation:shimmer 2.5s linear infinite;
  }
  .av-btn--forge:hover { box-shadow:0 6px 32px #7C3AED66;transform:translateY(-1px); }
  .av-btn-row     { display:flex;gap:8px; }
  .av-btn--shop   { flex:1;background:#0A0808;border:1px solid #3A1A1A!important;color:#F87171; }
  .av-btn--shop:hover { background:#150A0A; }
  .av-btn--inv    { flex:1;background:#08080A;border:1px solid #1A1A3A!important;color:#60A5FA; }
  .av-btn--inv:hover { background:#0A0A18; }

  /* section title */
  .av-section-title { display:flex;align-items:center;gap:10px;font-family:'Press Start 2P',monospace;font-size:7px;color:#2A1A50;letter-spacing:3px;white-space:nowrap; }
  .av-section-line  { flex:1;height:1px;background:linear-gradient(90deg,transparent,#1A1040,transparent); }

  /* equipment grid */
  .av-eq-section { display:flex;flex-direction:column;gap:12px; }
  .av-eq-grid    { display:flex;flex-direction:column;gap:6px; }

  .av-eq-card {
    border-radius:12px; overflow:hidden;
    border:1px solid #0E0E1C;
    background:#07070E;
    transition:border-color .15s,background .15s,box-shadow .15s;
  }
  .av-eq-card--open {
    border-color:var(--accent,#FFF)40;
    background:var(--accent,#FFF)06;
    box-shadow:0 0 24px var(--shadow,transparent);
  }
  .av-eq-head {
    width:100%;display:flex;align-items:center;gap:10px;
    padding:11px 14px;background:none;border:none;cursor:pointer;text-align:left;
    transition:background .1s;
  }
  .av-eq-head:hover { background:rgba(255,255,255,.02); }
  .av-eq-icon-wrap {
    width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;
    background:var(--accent,#FFF)15;border:1px solid var(--accent,#FFF)25;
    color:var(--accent,#FFF);
  }
  .av-eq-info { flex:1;min-width:0; }
  .av-eq-slot-name  { display:block;font-family:'Press Start 2P',monospace;font-size:7px;color:var(--accent,#FFF);letter-spacing:2px;margin-bottom:3px; }
  .av-eq-item-name  { display:block;font-size:13px;font-weight:700;color:#E8E8F0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
  .av-eq-empty      { display:block;font-size:12px;color:#1E1A30;font-style:italic; }
  .av-eq-bonus      { display:block;font-size:10px;color:var(--accent,#FFF)99;margin-top:2px; }
  .av-eq-sprite-wrap { flex-shrink:0; }
  .av-eq-chevron { color:#1E1A30;font-size:11px;transition:transform .2s;flex-shrink:0;margin-left:4px; }
  .av-eq-chevron--open { transform:rotate(180deg); }

  /* drawer */
  .av-eq-drawer { padding:0 12px 12px;border-top:1px solid var(--accent,#FFF)12; }
  .av-unequip {
    display:inline-flex;align-items:center;gap:5px;
    margin:10px 0; padding:5px 10px; border-radius:7px;
    background:#180A0A; border:1px solid #3A1A1A; color:#F87171;
    font-family:'Press Start 2P',monospace;font-size:6px;cursor:pointer;
  }
  .av-eq-empty-state { padding:20px 0;text-align:center; }
  .av-eq-empty-state p   { font-family:'Press Start 2P',monospace;font-size:7px;color:#1E1A30;margin:0 0 8px; }
  .av-eq-empty-state button { font-family:'Press Start 2P',monospace;font-size:7px;color:var(--accent,#FFF);background:none;border:none;cursor:pointer;text-decoration:underline; }

  /* item grid */
  .av-item-grid { display:grid;grid-template-columns:repeat(auto-fill,minmax(68px,1fr));gap:7px;padding-top:10px; }
  .av-item-btn  {
    position:relative;display:flex;flex-direction:column;align-items:center;gap:4px;
    padding:7px 5px;border-radius:9px;border:2px solid #0E0E1E;background:#070710;
    cursor:pointer;transition:all .1s;
  }
  .av-item-btn:hover   { transform:scale(1.07); border-color:#7C3AED; }
  .av-item-btn--eq     { border-color:var(--accent,#FFF);background:var(--accent,#FFF)10;box-shadow:0 0 14px var(--accent,#FFF)33; }
  .av-item-btn--pv     { border-color:#7C3AED55;background:#3B0D8010; }
  .av-item-check {
    position:absolute;top:-6px;right:-6px;width:15px;height:15px;border-radius:50%;
    background:var(--accent,#FFF);display:flex;align-items:center;justify-content:center;
    font-size:8px;color:#000;font-weight:900;
  }
  .av-item-name { font-family:'Press Start 2P',monospace;font-size:5px;color:#3A3060;text-align:center;line-height:1.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:58px; }
  .av-preview-hint { font-family:'Press Start 2P',monospace;font-size:6px;color:#4C1D95;text-align:center;letter-spacing:1px;animation:glow-pulse 2s ease-in-out infinite; }

  ::-webkit-scrollbar { width:3px }
  ::-webkit-scrollbar-thumb { background:#181530;border-radius:2px }
`;