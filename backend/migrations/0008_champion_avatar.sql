-- 0008: the pixel champion becomes the avatar (Phase 3, Stage 1).
--
--   * user_avatar.champion_id      which of the six champions the player is (NULL = never set: the default shows).
--   * user_avatar.champion_set_at  when the PLAYER chose it. NULL for a champion this migration mapped, so the
--                                  browser may still replace it once with the pick it kept locally in Phase 2.
--   * The retired Hero Forge look is mapped: its body type picks the nearest champion (male_default -> kaien,
--     male_athletic -> brak, female_elegant -> mira, female_sporty -> asha; same table as
--     services/progression/champions.py). The legacy outfit_id key becomes the armor slot when that is empty,
--     and the forge-only keys (skin, hair, eyes, lips, body type, outfit_id) are dropped. The shop items in the
--     slots are untouched: they are the champion's skins now, with the same ids, owners and bonuses.
--   * Rows whose equipped_json is not valid JSON are left exactly as they are.
ALTER TABLE user_avatar ADD COLUMN champion_id TEXT
    CHECK (champion_id IS NULL OR champion_id IN ('kaien', 'asha', 'brak', 'mira', 'vex', 'thorne'));
ALTER TABLE user_avatar ADD COLUMN champion_set_at TEXT;

UPDATE user_avatar
   SET champion_id = CASE json_extract(equipped_json, '$.body_type_id')
                         WHEN 'male_default'   THEN 'kaien'
                         WHEN 'male_athletic'  THEN 'brak'
                         WHEN 'female_elegant' THEN 'mira'
                         WHEN 'female_sporty'  THEN 'asha'
                     END
 WHERE json_valid(equipped_json);

UPDATE user_avatar
   SET equipped_json = json_set(equipped_json, '$.armor', json_extract(equipped_json, '$.outfit_id'))
 WHERE json_valid(equipped_json)
   AND json_type(equipped_json) = 'object'
   AND COALESCE(json_extract(equipped_json, '$.armor'), '') = ''
   AND COALESCE(json_extract(equipped_json, '$.outfit_id'), '') <> '';

UPDATE user_avatar
   SET equipped_json = json_remove(equipped_json, '$.skin_id', '$.hair_id', '$.eye_color_id', '$.lip_color_id',
                                   '$.body_type_id', '$.outfit_id')
 WHERE json_valid(equipped_json)
   AND json_type(equipped_json) = 'object';
