CREATE TABLE `list_items` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`rev` integer DEFAULT 1 NOT NULL,
	`text` text NOT NULL,
	`done_at` integer
);
