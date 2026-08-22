"use client";

import { LockKeyhole, MessageCircle, MessageCircleMore } from "lucide-react";
import type { Article, ArticleQuestionOption } from "../lib/types";
import { INTEREST_LEVELS } from "../lib/interest";
import { QuestionBlock, isAnswerComplete, type Answers } from "./question-block";

export function OpinionSheet({
  article, interest, onInterest, answers, onAnswer, comment, setComment, saving, onCancel, onSave,
}: {
  article: Article;
  interest: number;
  onInterest: (value: number) => void;
  answers: Answers;
  onAnswer: (questionId: string, stance: ArticleQuestionOption["stance"]) => void;
  comment: string;
  setComment: (value: string) => void;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const complete = isAnswerComplete(article.questions, answers);

  return (
    <>
      <div className="sheet-backdrop" onClick={onCancel} />
      <div className="opinion-sheet" role="dialog" aria-modal="true" aria-label="この記事への意見">
        <div className="sheet-head">
          <span className="sheet-grabber" />
          <div className="sheet-title">
            <div><span className="sheet-icon"><MessageCircleMore size={17} /></span><strong>この記事への意見</strong></div>
            <span><LockKeyhole size={12} /> 非公開</span>
          </div>
        </div>

        <div className="sheet-body">
          <section className="sheet-section">
            <div className="sheet-section-head"><strong>このニュースへの関心度</strong></div>
            <div className="interest-levels">
              {INTEREST_LEVELS.map((level) => (
                <button
                  type="button"
                  key={level.value}
                  className={interest === level.value ? "interest-level selected" : "interest-level"}
                  aria-pressed={interest === level.value}
                  onClick={() => onInterest(level.value)}
                >
                  {level.label}
                </button>
              ))}
            </div>
          </section>

          <QuestionBlock questions={article.questions} answers={answers} onAnswer={onAnswer} />

          <section className="sheet-section">
            <div className="sheet-section-head"><strong>思ったこと・考えたこと<span className="optional-mark">（任意）</span></strong></div>
            <label className="comment-box">
              <MessageCircle size={18} />
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                maxLength={160}
                placeholder="なぜそう思いましたか？"
                aria-label="この記事についてのコメント"
              />
            </label>
          </section>
        </div>

        <div className="sheet-foot">
          {!complete && <p className="sheet-hint">すべての設問に答えると保存できます。</p>}
          <div className="sheet-actions">
            <button type="button" className="ghost-button" onClick={onCancel} disabled={saving}>キャンセル</button>
            <button type="button" className="primary-button" onClick={onSave} disabled={saving || !complete}>
              {saving ? <><span className="button-spinner" />保存しています</> : "保存する"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
