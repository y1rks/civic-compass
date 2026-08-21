CREATE TABLE `articles` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`body` text NOT NULL,
	`image` text NOT NULL,
	`source` text NOT NULL,
	`published_at` text NOT NULL,
	`read_time` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `interests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`article_id` text NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
	`saved_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `interests_user_id_idx` ON `interests` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `interests_user_article_unq` ON `interests` (`user_id`,`article_id`);--> statement-breakpoint
CREATE TABLE `matches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`politician_id` text NOT NULL,
	`article_id` text,
	`score` real NOT NULL,
	`reason` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`politician_id`) REFERENCES `politicians`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `matches_user_id_idx` ON `matches` (`user_id`);--> statement-breakpoint
CREATE TABLE `politicians` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`initials` text NOT NULL,
	`party` text NOT NULL,
	`area` text NOT NULL,
	`color` text NOT NULL,
	`website` text NOT NULL
);
