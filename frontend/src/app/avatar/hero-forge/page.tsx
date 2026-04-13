"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import PixelAvatarBuilder, {
  AvatarConfig, DEFAULT_CONFIG,
  SKIN_TONES, HAIR_COLORS, BODY_TYPES,
} from "@/components/PixelAvatar";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function HeroForgePage() {
  const router = useRouter();

  const [config,           setConfig]           = useState<AvatarConfig>(DEFAULT_CONFIG);
  const [savedConfig,      setSavedConfig]      = useState<AvatarConfig | null>(null);
  const [loading,          setLoading]          = useState(true);
  const [saving,           setSaving]           = useState(false);
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const [ownedItemIds,     setOwnedItemIds]     = useState<string[] | null>(null);

  const hasUnsaved = !!savedConfig && JSON.stringify(config) !== JSON.stringify(savedConfig);

  useEffect(() => {
    (async () => {
      try {
        const avatarRes = await fetch(`${API}/avatar`, { credentials: "include" });
        if (avatarRes.ok) {
          const data = await avatarRes.json();
          const eq   = data.equipped || {};
          const loaded: AvatarConfig = {
            bodyTypeId: eq.body_type_id || "male_default",
            skinId:     eq.skin_id      || "ivory",
            hairId:     eq.hair_id      || "black",
            eyeColorId: eq.eye_color_id || "blue",
            lipColorId: eq.lip_color_id || "natural",
            armorId:    eq.armor        || eq.outfit_id || "armor_shirt_basic",
            headId:     eq.headgear     || "",
            weaponId:   eq.weapon       || "",
            petId:      eq.pet          || "",
          };
          setConfig(loaded);
          setSavedConfig(loaded);
        }
        const shopRes = await fetch(`${API}/shop`, { credentials: "include" });
        if (shopRes.ok) {
          const shopData = await shopRes.json();
          const ids: string[] = (shopData.items || [])
            .filter((i: any) => i.owned)
            .map((i: any) => i.id as string);
          if (!ids.includes("armor_shirt_basic")) ids.unshift("armor_shirt_basic");
          setOwnedItemIds(ids);
        }
      } catch { /* offline */ }
      setLoading(false);
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API}/avatar/hero-forge-save`, {
        method:      "POST",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body: JSON.stringify({
          body_type_id: config.bodyTypeId,
          skin_id:      config.skinId,
          hair_id:      config.hairId,
          eye_color_id: config.eyeColorId,
          lip_color_id: config.lipColorId,
          outfit_id:    config.armorId,
          headgear:     config.headId   || "",
          weapon:       config.weaponId || "",
          pet:          config.petId    || "",
        }),
      });

      if (res.ok) {
        const syncSlots: { slot: string; item_id: string }[] = [
          { slot: "armor",    item_id: config.armorId  },
          { slot: "headgear", item_id: config.headId   },
          { slot: "weapon",   item_id: config.weaponId },
          { slot: "pet",      item_id: config.petId    },
        ];
        await Promise.allSettled(
          syncSlots.map(({ slot, item_id }) => {
            if (!item_id) {
              return fetch(`${API}/shop/unequip`, {
                method: "POST", credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ slot }),
              });
            }
            return fetch(`${API}/shop/equip`, {
              method: "POST", credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ user_id: "ignored", item_id }),
            });
          })
        );
        setSavedConfig({ ...config });
      }
    } catch { /* offline */ }
    setSaving(false);
  };

  const handleBack = () => {
    if (hasUnsaved) setShowUnsavedModal(true);
    else router.push("/avatar");
  };

  const handleConfigChange = useCallback((key: keyof AvatarConfig, val: string) =>
    setConfig(prev => ({ ...prev, [key]: val })), []);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#050510", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 48, height: 48, border: "3px solid #AA44FF", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 16px" }} />
          <span style={{ color: "#5533AA", fontFamily: "'Press Start 2P',monospace", fontSize: 8 }}>FORGING HERO...</span>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{
      height:        "100vh",
      overflow:      "hidden",
      paddingTop:    52,
      paddingLeft:   16,
      paddingRight:  16,
      paddingBottom: 0,
      background:    "#050510",
      fontFamily:    "'Press Start 2P','Courier New',monospace",
      display:       "flex",
      flexDirection: "column",
      alignItems:    "center",
      position:      "relative",
    }}>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');
        * { box-sizing: border-box; }
        @keyframes fab-float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
        @keyframes fab-glow  { 0%,100%{box-shadow:0 0 16px #3311AA22} 50%{box-shadow:0 0 36px #AA44FF44} }
        @keyframes star-drift { 0%{opacity:0;transform:translateY(0) scale(0)} 10%{opacity:1} 90%{opacity:0.3} 100%{opacity:0;transform:translateY(-60px) scale(1.5)} }
        @keyframes title-glow { 0%,100%{text-shadow:0 0 16px #FFCC0044} 50%{text-shadow:0 0 32px #FFCC0099,0 0 60px #FFAA0033} }
        .fab-float { animation: fab-float 3s ease-in-out infinite; }
        .fab-glow  { animation: fab-glow  2.5s ease-in-out infinite; }
        .hf-title  { animation: title-glow 3s ease-in-out infinite; }

        .hf-back {
          display:flex; align-items:center; gap:8px; padding:8px 16px;
          background:transparent; border:1px solid #2A1A50; border-radius:8px;
          color:#7744CC; font-family:'Press Start 2P',monospace; font-size:7px;
          cursor:pointer; transition:all 0.15s;
        }
        .hf-back:hover { background:rgba(170,68,255,0.08); border-color:#7744CC; color:#AA44FF; }

        .hf-save {
          display:flex; align-items:center; gap:8px; padding:9px 20px;
          background:linear-gradient(135deg,#6622BB,#AA44FF); border:none; border-radius:8px;
          color:#fff; font-family:'Press Start 2P',monospace; font-size:8px; font-weight:700;
          cursor:pointer; transition:all 0.15s; box-shadow:0 4px 20px #AA44FF33;
        }
        .hf-save:hover:not(:disabled) { box-shadow:0 4px 28px #AA44FF66; transform:translateY(-1px); }
        .hf-save:disabled { opacity:0.5; cursor:not-allowed; transform:none; }

        .hf-save-indicator {
          font-size:7px; font-family:'Press Start 2P',monospace; transition:all 0.2s;
        }

        ::-webkit-scrollbar { width: 4px }
        ::-webkit-scrollbar-thumb { background: #2A1A4A; border-radius: 2px }
      `}</style>

      {/* Decorative bg stars */}
      {[...Array(12)].map((_, i) => (
        <div key={i} style={{
          position: "fixed",
          left:     `${10 + (i * 37 % 80)}%`,
          top:      `${5 + (i * 53 % 85)}%`,
          width:    i % 3 === 0 ? 3 : 2,
          height:   i % 3 === 0 ? 3 : 2,
          borderRadius: "50%",
          background: i % 4 === 0 ? "#FFCC00" : "#AA44FF",
          opacity: 0.2 + (i % 5) * 0.08,
          pointerEvents: "none",
          zIndex: 0,
          animation: `star-drift ${4 + (i % 4)}s ${i * 0.5}s ease-in-out infinite`,
        }} />
      ))}

      {/* Fixed top nav */}
      <div style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 1000,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 24px",
        background: "rgba(5,5,16,0.95)",
        borderBottom: "1px solid #18103A",
        backdropFilter: "blur(16px)",
      }}>
        <button className="hf-back" onClick={handleBack}>◀ Back</button>

        <div style={{ textAlign: "center" }}>
          <div className="hf-title" style={{ color: "#FFCC00", fontSize: 10, letterSpacing: 3, fontFamily: "inherit" }}>
            ⚔ HERO FORGE ⚔
          </div>
          <div style={{ color: "#3A2260", fontSize: 5, letterSpacing: 2, marginTop: 3 }}>CRAFT YOUR LEGEND</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className="hf-save-indicator" style={{ color: hasUnsaved ? "#FFCC00" : "#2A1A50" }}>
            {hasUnsaved ? "● UNSAVED" : "✓ Saved"}
          </span>
          <button className="hf-save" onClick={handleSave} disabled={saving}>
            {saving ? "SAVING..." : "💾 SAVE"}
          </button>
        </div>
      </div>

      {/* Unsaved modal */}
      {showUnsavedModal && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9999,
          background: "rgba(0,0,0,0.88)",
          display: "flex", alignItems: "center", justifyContent: "center",
          backdropFilter: "blur(6px)",
        }}>
          <div style={{
            background: "#0A0618", border: "1px solid #AA44FF",
            borderRadius: 14, padding: "36px 40px",
            textAlign: "center", maxWidth: 360,
            fontFamily: "'Press Start 2P',monospace",
            boxShadow: "0 0 60px #AA44FF22",
          }}>
            <div style={{ fontSize: 32, marginBottom: 16 }}>⚠️</div>
            <div style={{ fontSize: 10, color: "#FFCC00", marginBottom: 10, lineHeight: 2 }}>UNSAVED CHANGES</div>
            <div style={{ fontSize: 7, color: "#664488", lineHeight: 2.4, marginBottom: 28 }}>
              Your hero has unsaved changes.<br />Save before you leave?
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              <button onClick={() => { setShowUnsavedModal(false); router.push("/avatar"); }}
                style={{ padding: "10px 14px", borderRadius: 8, background: "#100820", border: "1px solid #330022", color: "#CC3366", cursor: "pointer", fontSize: 7, fontFamily: "inherit" }}>
                Discard
              </button>
              <button onClick={() => setShowUnsavedModal(false)}
                style={{ padding: "10px 14px", borderRadius: 8, background: "#100820", border: "1px solid #2A1A50", color: "#8855CC", cursor: "pointer", fontSize: 7, fontFamily: "inherit" }}>
                Keep Editing
              </button>
              <button onClick={async () => { await handleSave(); setShowUnsavedModal(false); router.push("/avatar"); }}
                style={{ padding: "10px 18px", borderRadius: 8, background: "linear-gradient(135deg,#5522AA,#AA44FF)", border: "none", color: "#fff", cursor: "pointer", fontSize: 7, fontFamily: "inherit", boxShadow: "0 4px 16px #AA44FF44" }}>
                Save & Exit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Builder */}
      <div style={{ position: "relative", zIndex: 1, width: "100%", height: "calc(100vh - 52px)", display: "flex", justifyContent: "center", alignItems: "stretch" }}>
        <PixelAvatarBuilder
          config={config}
          onConfigChange={handleConfigChange}
          ownedItemIds={ownedItemIds ?? undefined}
        />
      </div>
    </div>
  );
}