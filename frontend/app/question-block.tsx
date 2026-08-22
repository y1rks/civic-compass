"use client";

import { Check } from "lucide-react";
import type { Article, ArticleQuestionOption } from "../lib/types";

/** 設問ID → 選んだ stance。未回答の設問は入りません。 */
export type Answers = Record<string, ArticleQuestionOption["stance"]>;

/** すべての設問に答えたか。保存ボタンの活性判定に使います。 */
export function isAnswerComplete(questions: Article["questions"], answers: Answers): boolean {
  return questions.every((question) => Boolean(answers[question.id]));
}

/**
 * 記事の争点。1設問が frame × target × role のセル1つに対応し、
 * uphold / override / neutral から1つだけ選びます。
 *
 * 表示するのは選択肢の文面だけです。stance をボタンのラベルにすると
 * 「賛成／反対」と受け取られ、まったく別のものを測ってしまいます
 * （docs/design-constraints.md「ユーザー側の入力（記事の設問）」）。
 */
export function QuestionBlock({ questions, answers, onAnswer }: {
  questions: Article["questions"];
  answers: Answers;
  onAnswer: (questionId: string, stance: ArticleQuestionOption["stance"]) => void;
}) {
  if (questions.length === 0) return null;

  const answered = questions.filter((question) => answers[question.id]).length;

  return (
    <section className="sheet-section">
      <div className="sheet-section-head">
        <strong>考えに近いものを選んでください。<span className="required-mark">（必須選択）</span></strong>
        <span className="question-progress">{answered}/{questions.length}</span>
      </div>
      {questions.map((question) => (
        <fieldset className="question-card" key={question.id}>
          <legend>{question.prompt}</legend>
          <div className="option-list">
            {question.options.map((option) => {
              const selected = answers[question.id] === option.stance;
              return (
                <label className={selected ? "option selected" : "option"} key={option.id}>
                  <input
                    type="radio"
                    name={question.id}
                    value={option.stance}
                    checked={selected}
                    onChange={() => onAnswer(question.id, option.stance)}
                  />
                  <span className="option-mark">{selected && <Check size={12} strokeWidth={3} />}</span>
                  <span className="option-label">{option.label}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
    </section>
  );
}
