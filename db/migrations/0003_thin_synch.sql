CREATE TABLE `answer_selections` (
	`answer_id` text NOT NULL,
	`question_id` text NOT NULL,
	`stance` text NOT NULL,
	`frame` text NOT NULL,
	`target` text NOT NULL,
	`role` text NOT NULL,
	`intensity` real NOT NULL,
	`confidence` real NOT NULL,
	`source` text DEFAULT 'question' NOT NULL,
	PRIMARY KEY(`answer_id`, `question_id`),
	FOREIGN KEY (`answer_id`) REFERENCES `answers`(`answer_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`question_id`) REFERENCES `article_questions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "answer_selections_stance_check" CHECK(stance IN ('uphold', 'override', 'neutral')),
	CONSTRAINT "answer_selections_frame_check" CHECK(frame IN ('care_harm', 'fairness', 'liberty_autonomy', 'loyalty_community', 'authority_order', 'sanctity_tradition', 'efficiency_utility', 'procedure_rule_of_law', 'sovereignty', 'evidence_expertise')),
	CONSTRAINT "answer_selections_target_check" CHECK(target IN ('個人', '家族', '子ども・将来世代', '高齢者', '現役世代', '女性', '障害者・マイノリティ', '中小企業', '大企業・産業', '地方', '国民全体', '外国人・移民', '国際社会', '自然環境')),
	CONSTRAINT "answer_selections_role_check" CHECK(role IN ('beneficiary', 'threat')),
	CONSTRAINT "answer_selections_source_check" CHECK(source IN ('question', 'llm'))
);
--> statement-breakpoint
CREATE INDEX `answer_selections_cell_idx` ON `answer_selections` (`frame`,`target`,`role`);--> statement-breakpoint
CREATE TABLE `answers` (
	`answer_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`article_id` text NOT NULL,
	`interest` real NOT NULL,
	`opinion_text` text,
	`extract_version` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "answers_interest_check" CHECK(interest >= 0 AND interest <= 1)
);
--> statement-breakpoint
CREATE INDEX `answers_user_idx` ON `answers` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `answers_user_article_idx` ON `answers` (`user_id`,`article_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`user_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`last_login_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_idx` ON `users` (`email`);
--> statement-breakpoint
-- 開発用のテストユーザー。ログイン機構がまだ無いので last_login_at は null。
-- メールは RFC 2606 で予約されている example.com を使い、実在の宛先に届かないようにする。
INSERT INTO `users` (`user_id`, `name`, `email`) VALUES
  ('test_user1', 'test_user1', 'test_user1@example.com');
