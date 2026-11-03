CREATE TABLE `schedule_events` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`rev` integer DEFAULT 1 NOT NULL,
	`title` text NOT NULL,
	`location` text,
	`weekdays` integer NOT NULL,
	`date` text,
	`start_local` text NOT NULL,
	`end_local` text,
	`starts_on` text,
	`ends_on` text
);
