"use client";

import { Swords } from "lucide-react";
import { ButtonLink, Card } from "@/components/ui";
import ActiveBuffsSidebar from "@/components/ActiveBuffsSidebar";
import QuestPanel from "@/components/QuestPanel";
import { ROUTES } from "@/lib/routes";

/** Today's quests, the buffs that are running, and the way into the arena. (Level, XP, coins and streak are in the header.) */
export default function QuestsTab() {
  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 grid gap-6 md:grid-cols-2">
      <Card title="Daily quests">
        <div className="-mx-5 -mt-4 -mb-5">
          <QuestPanel />
        </div>
      </Card>

      <div className="grid gap-6 content-start">
        {/* Draws nothing while no timed buff is running. */}
        <ActiveBuffsSidebar />

        <Card title="Arena">
          <p className="text-sm text-fg-2">Summon a boss on any topic and battle it with what you have learned.</p>
          <ButtonLink href={ROUTES.heroArena} variant="primary" className="self-start">
            <Swords size={16} aria-hidden="true" />Enter the arena
          </ButtonLink>
        </Card>
      </div>
    </div>
  );
}
