-- 0009: champion kits and progression (Phase 3, Stage 2).
--
--   * champion_progress   per user + champion: XP earned in battles fought with that champion (+10 per right
--                         answer, +50 per win; core_brains/kits.py), its level (1-10) and battle counts. Written
--                         once per battle, inside the transaction that ends it. Levels 3 / 6 / 10 unlock that
--                         champion's three mastery skins (granted into user_avatar.owned_json in the same write).
--   * The kit itself (passive, ultimate meter) lives in arena_battles.boss_json["kit"], snapshotted at the start.
CREATE TABLE champion_progress (
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    champion_id  TEXT NOT NULL CHECK (champion_id IN ('kaien', 'asha', 'brak', 'mira', 'vex', 'thorne')),
    xp           INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
    level        INTEGER NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 10),
    battles      INTEGER NOT NULL DEFAULT 0,
    wins         INTEGER NOT NULL DEFAULT 0,
    updated_at   TEXT NOT NULL,
    PRIMARY KEY (user_id, champion_id)
);
