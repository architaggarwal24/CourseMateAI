-- Security audit run 2.
-- Document boards group runs by a hash the server checked (src/server/game/board.ts).
ALTER TABLE `arena_runs` ADD `board_hash` text;
--> statement-breakpoint
-- The weekly board showed Nemesis, Invasion and Season topics, which list the player's own missed or studied
-- concepts. Keep only the mode's name on scores already recorded.
UPDATE `arena_scores` SET `topic` = trim(substr(`topic`, 1, instr(`topic`, ':') - 1))
  WHERE instr(`topic`, ':') > 0 AND `battle_id` IN (SELECT `id` FROM `arena_battles` WHERE `mode` IN ('nemesis', 'invasion', 'season'));
--> statement-breakpoint
-- Concept maps from before audit run 1 were keyed by the bare file hash and shared between accounts. Nothing reads
-- them any more (keys are now "u<userId>:<hash>"), and account deletion can't find them, so they go.
DELETE FROM `concept_maps` WHERE `doc_hash` NOT LIKE 'u%:%';
