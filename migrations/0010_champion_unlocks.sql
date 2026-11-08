CREATE TABLE `champion_unlocks` (
	`user_id` integer NOT NULL,
	`champion_id` text NOT NULL,
	`source` text NOT NULL,
	`unlocked_at` text NOT NULL,
	`celebrated_at` text,
	PRIMARY KEY(`user_id`, `champion_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- Anyone who already picked a champion keeps it (and any champion they have fought with), with no ceremony.
INSERT OR IGNORE INTO `champion_unlocks` (`user_id`, `champion_id`, `source`, `unlocked_at`, `celebrated_at`)
SELECT `user_id`, `champion_id`, 'kept', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `user_avatar` WHERE `champion_id` IN ('asha', 'brak', 'mira', 'vex', 'thorne');
--> statement-breakpoint
INSERT OR IGNORE INTO `champion_unlocks` (`user_id`, `champion_id`, `source`, `unlocked_at`, `celebrated_at`)
SELECT `user_id`, `champion_id`, 'kept', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `champion_progress` WHERE `battles` > 0 AND `champion_id` IN ('asha', 'brak', 'mira', 'vex', 'thorne');
