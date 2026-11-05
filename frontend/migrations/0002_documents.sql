CREATE TABLE `course_documents` (
	`course_id` text NOT NULL,
	`document_id` text NOT NULL,
	`position` integer NOT NULL,
	`added_at` text NOT NULL,
	PRIMARY KEY(`course_id`, `document_id`),
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `course_documents_doc_idx` ON `course_documents` (`document_id`);--> statement-breakpoint
CREATE TABLE `courses` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `courses_user_idx` ON `courses` (`user_id`);--> statement-breakpoint
CREATE TABLE `document_chunks` (
	`document_id` text NOT NULL,
	`idx` integer NOT NULL,
	`page` integer NOT NULL,
	`text` text NOT NULL,
	PRIMARY KEY(`document_id`, `idx`),
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`filename` text NOT NULL,
	`file_hash` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`pages` integer NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`chunks` integer DEFAULT 0 NOT NULL,
	`indexed_pages` integer DEFAULT 0 NOT NULL,
	`embedding_model` text NOT NULL,
	`pdf_stored` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_used_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `documents_user_idx` ON `documents` (`user_id`);--> statement-breakpoint
CREATE INDEX `documents_hash_idx` ON `documents` (`file_hash`);