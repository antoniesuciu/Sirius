CREATE TABLE `note_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`rev` integer DEFAULT 1 NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`rev` integer DEFAULT 1 NOT NULL,
	`folder_id` text,
	`title` text NOT NULL,
	`body` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notes_folder` ON `notes` (`folder_id`);