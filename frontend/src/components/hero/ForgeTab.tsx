"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HeroForge } from "@/components/avatar";
import { DEFAULT_LOOK as DEFAULT_CONFIG, lookFromEquipped, type Look as AvatarConfig } from "@/lib/avatar/look";
import { Check, ChevronLeft, Save } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { useHeroStore } from "@/hooks/useHero";
import { rawApi } from "@/lib/api";

/** Hero Forge inside the Hero area: build the look, save it, and the header, shop and inventory follow. */
export default function ForgeTab({ onBack }: { onBack: () => void }) {
  const shop = useHeroStore((s) => s.shop);
  const shopLoading = useHeroStore((s) => s.loading);
  const setForgeGuard = useHeroStore((s) => s.setForgeGuard);
  const afterForgeSave = useHeroStore((s) => s.afterForgeSave);

  const [config, setConfig] = useState<AvatarConfig>(DEFAULT_CONFIG);
  const [savedConfig, setSavedConfig] = useState<AvatarConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const hasUnsaved = !!savedConfig && JSON.stringify(config) !== JSON.stringify(savedConfig);

  useEffect(() => {
    (async () => {
      try {
        const { data, response } = await rawApi.GET("/avatar");
        if (response.ok && data) {
          const loaded: AvatarConfig = lookFromEquipped((data.equipped || {}) as Record<string, string>);
          setConfig(loaded);
          setSavedConfig(loaded);
        }
      } catch { /* offline */ }
      setLoading(false);
    })();
  }, []);

  // What the hero owns comes from the shared store (the same list the shop and inventory show).
  const ownedItemIds = useMemo(() => {
    const ids = (shop?.items ?? []).filter((i) => i.owned).map((i) => i.id);
    if (!ids.includes("armor_shirt_basic")) ids.unshift("armor_shirt_basic");
    return ids;
  }, [shop]);

  const configRef = useRef(config);
  configRef.current = config;

  const save = useCallback(async (): Promise<boolean> => {
    const c = configRef.current;
    setSaving(true);
    let ok = false;
    try {
      const { response: res } = await rawApi.POST("/avatar/hero-forge-save", {
        body: {
          body_type_id: c.bodyTypeId,
          skin_id:      c.skinId,
          hair_id:      c.hairId,
          eye_color_id: c.eyeColorId,
          lip_color_id: c.lipColorId,
          outfit_id:    c.armorId,
          headgear:     c.headId   || "",
          weapon:       c.weaponId || "",
          pet:          c.petId    || "",
        },
      });

      if (res.ok) {
        const syncSlots: { slot: string; item_id: string }[] = [
          { slot: "armor",    item_id: c.armorId  },
          { slot: "headgear", item_id: c.headId   },
          { slot: "weapon",   item_id: c.weaponId },
          { slot: "pet",      item_id: c.petId    },
        ];
        await Promise.allSettled(
          syncSlots.map(({ slot, item_id }) =>
            item_id
              ? rawApi.POST("/shop/equip", { body: { item_id } })
              : rawApi.POST("/shop/unequip", { body: { slot } }),
          ),
        );
        setSavedConfig({ ...c });
        ok = true;
        await afterForgeSave();                     // the header, shop and inventory now show the new look
      }
    } catch { /* offline */ }
    setSaving(false);
    return ok;
  }, [afterForgeSave]);

  // Tell the Hero area whether leaving this tab would lose edits (it asks before navigating away).
  useEffect(() => { setForgeGuard({ dirty: hasUnsaved, save }); }, [hasUnsaved, save, setForgeGuard]);
  useEffect(() => () => setForgeGuard(null), [setForgeGuard]);

  const handleConfigChange = useCallback((key: keyof AvatarConfig, val: string) =>
    setConfig((prev) => ({ ...prev, [key]: val })), []);

  if (loading || shopLoading) {
    return <p role="status" className="p-6 text-fg-muted">Forging hero…</p>;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="forge-bar">
        <Button variant="secondary" size="sm" onClick={onBack}><ChevronLeft size={14} aria-hidden="true" />Avatar</Button>

        <div className="forge-bar__title">
          <h2>Hero Forge</h2>
          <p>Craft your legend</p>
        </div>

        <div className="flex items-center gap-3">
          <Badge tone={hasUnsaved ? "reward" : "success"} role="status">{hasUnsaved ? "Unsaved" : <><Check size={11} aria-hidden="true" />Saved</>}</Badge>
          <Button variant="primary" size="sm" onClick={() => { void save(); }} loading={saving}>
            {!saving && <Save size={14} aria-hidden="true" />}{saving ? "Saving" : "Save"}
          </Button>
        </div>
      </div>

      <HeroForge look={config} onChange={handleConfigChange} items={(shop?.items ?? []) as never} owned={ownedItemIds} />
    </div>
  );
}
