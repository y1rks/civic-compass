CREATE TABLE `utterance_frame_targets` (
	`frame_id` text NOT NULL,
	`entity` text NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`frame_id`, `entity`, `role`),
	FOREIGN KEY (`frame_id`) REFERENCES `utterance_frames`(`frame_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `utterance_frame_targets_cell_idx` ON `utterance_frame_targets` (`entity`,`role`);--> statement-breakpoint
CREATE TABLE `utterance_frames` (
	`frame_id` text PRIMARY KEY NOT NULL,
	`utterance_id` text NOT NULL,
	`speaker_id` text NOT NULL,
	`frame` text NOT NULL,
	`stance` text NOT NULL,
	`intensity` real NOT NULL,
	`evidence_text` text NOT NULL,
	`evidence_span_start` integer,
	`evidence_span_end` integer,
	`evidence_match` text NOT NULL,
	FOREIGN KEY (`utterance_id`) REFERENCES `utterances`(`utterance_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `utterance_frames_utterance_idx` ON `utterance_frames` (`utterance_id`);--> statement-breakpoint
CREATE INDEX `utterance_frames_speaker_idx` ON `utterance_frames` (`speaker_id`);--> statement-breakpoint
CREATE INDEX `utterance_frames_cell_idx` ON `utterance_frames` (`speaker_id`,`frame`);--> statement-breakpoint
CREATE TABLE `utterances` (
	`utterance_id` text PRIMARY KEY NOT NULL,
	`speaker_id` text NOT NULL,
	`politician_name` text NOT NULL,
	`source_kind` text NOT NULL,
	`meeting_id` text,
	`speech_id` text,
	`speech_index` integer,
	`segment_index` integer NOT NULL,
	`char_range_start` integer NOT NULL,
	`char_range_end` integer NOT NULL,
	`url` text,
	`date` text,
	`speech_type` text NOT NULL,
	`answer_context` text NOT NULL,
	`weight` real NOT NULL,
	`position_at_time` text,
	`party_at_time` text,
	`extract_version` text NOT NULL,
	`segmentation_version` text NOT NULL,
	`no_value_content` integer NOT NULL,
	`summary` text,
	`confidence` real,
	`quote` text NOT NULL,
	`block_text` text,
	`quotable` integer NOT NULL,
	`rejected_frames` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `utterances_speaker_idx` ON `utterances` (`speaker_id`);--> statement-breakpoint
CREATE INDEX `utterances_date_idx` ON `utterances` (`date`);