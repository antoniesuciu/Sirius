CREATE TABLE `agent_events` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`rev` integer DEFAULT 1 NOT NULL,
	`source` text NOT NULL,
	`kind` text NOT NULL,
	`project` text,
	`message` text,
	`acknowledged_at` integer
);
--> statement-breakpoint
CREATE TABLE `change_log` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`op` text NOT NULL,
	`actor` text NOT NULL,
	`payload` text NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `change_log_batch` ON `change_log` (`batch_id`);--> statement-breakpoint
CREATE INDEX `change_log_at` ON `change_log` (`at`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`rev` integer DEFAULT 1 NOT NULL,
	`agent` text NOT NULL,
	`model` text NOT NULL,
	`cli_session_id` text,
	`title` text
);
--> statement-breakpoint
CREATE TABLE `day_state` (
	`date` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`rev` integer DEFAULT 1 NOT NULL,
	`quiet_mode` integer NOT NULL,
	`quiet_since` integer
);
--> statement-breakpoint
CREATE TABLE `goals` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`rev` integer DEFAULT 1 NOT NULL,
	`title` text NOT NULL,
	`horizon_text` text,
	`target_date` text,
	`status` text NOT NULL,
	`position` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`rev` integer DEFAULT 1 NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`text` text NOT NULL,
	`meta` text
);
--> statement-breakpoint
CREATE INDEX `messages_conversation` ON `messages` (`conversation_id`);--> statement-breakpoint
CREATE TABLE `milestones` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`rev` integer DEFAULT 1 NOT NULL,
	`goal_id` text NOT NULL,
	`title` text NOT NULL,
	`position` integer NOT NULL,
	`done_at` integer
);
--> statement-breakpoint
CREATE INDEX `milestones_goal` ON `milestones` (`goal_id`);--> statement-breakpoint
CREATE TABLE `proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`rev` integer DEFAULT 1 NOT NULL,
	`actor` text NOT NULL,
	`summary` text NOT NULL,
	`ops` text NOT NULL,
	`status` text NOT NULL,
	`decided_at` integer,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`rev` integer DEFAULT 1 NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`time_local` text NOT NULL,
	`weekdays` integer NOT NULL,
	`enabled` integer NOT NULL,
	`snoozed_until` integer,
	`last_fired_on` text
);
--> statement-breakpoint
CREATE TABLE `roadmap_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`rev` integer DEFAULT 1 NOT NULL,
	`roadmap_id` text NOT NULL,
	`title` text NOT NULL,
	`est_minutes` integer,
	`position` integer NOT NULL,
	`status` text NOT NULL,
	`done_at` integer
);
--> statement-breakpoint
CREATE INDEX `roadmap_steps_roadmap` ON `roadmap_steps` (`roadmap_id`);--> statement-breakpoint
CREATE TABLE `roadmaps` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`rev` integer DEFAULT 1 NOT NULL,
	`title` text NOT NULL,
	`subtitle` text,
	`status` text NOT NULL,
	`position` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`rev` integer DEFAULT 1 NOT NULL,
	`value` text
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`rev` integer DEFAULT 1 NOT NULL,
	`title` text NOT NULL,
	`tier` text NOT NULL,
	`scheduled_for` text NOT NULL,
	`status` text NOT NULL,
	`position` integer NOT NULL,
	`completed_at` integer,
	`source` text NOT NULL,
	`roadmap_step_id` text
);
--> statement-breakpoint
CREATE INDEX `tasks_scheduled_for` ON `tasks` (`scheduled_for`);--> statement-breakpoint
CREATE TABLE `voice_turns` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`rev` integer DEFAULT 1 NOT NULL,
	`conversation_id` text,
	`lang` text NOT NULL,
	`transcript` text NOT NULL,
	`route` text NOT NULL,
	`intent` text,
	`latency_ms` text
);
