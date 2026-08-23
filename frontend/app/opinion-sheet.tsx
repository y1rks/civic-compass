"use client";

import { useRef, type CSSProperties, type PointerEvent } from "react";
import { MessageCircle, MessageCircleMore } from "lucide-react";
import type { Article, ArticleQuestionOption } from "../lib/types";
import { INTEREST_LEVELS, interestIndex } from "../lib/interest";
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
  const grabberStartY = useRef<number | null>(null);
  const grabberDragged = useRef(false);

  const startDragging = (event: PointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary) return;
    grabberStartY.current = event.clientY;
    grabberDragged.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const trackDragging = (event: PointerEvent<HTMLButtonElement>) => {
    if (grabberStartY.current === null) return;
    if (event.clientY - grabberStartY.current > 8) grabberDragged.current = true;
  };

  const finishDragging = (event: PointerEvent<HTMLButtonElement>) => {
    const startY = grabberStartY.current;
    grabberStartY.current = null;
    if (startY !== null && event.clientY - startY >= 72) onCancel();
  };

  return (
    <>
      <div className="sheet-backdrop" onClick={onCancel} />
      <div className="opinion-sheet" role="dialog" aria-modal="true" aria-label="この記事への意見">
        <div className="sheet-head">
          <button
            type="button"
            className="sheet-grabber"
            aria-label="シートを閉じる"
            onPointerDown={startDragging}
            onPointerMove={trackDragging}
            onPointerUp={finishDragging}
            onPointerCancel={() => { grabberStartY.current = null; }}
            onClick={() => { if (!grabberDragged.current) onCancel(); }}
          />
          <div className="sheet-title">
            <div><span className="sheet-icon"><MessageCircleMore size={17} /></span><strong>この記事への意見</strong></div>
          </div>
        </div>

        <div className="sheet-body">
          <section className="sheet-section">
            <div className="sheet-section-head"><strong>このニュースへの関心度</strong></div>
            <InterestSlider value={interest} onChange={onInterest} />
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

/**
 * 関心度の入力。4段階を目盛りとして持つスライダーです。
 *
 * ボタンを4つ並べると選択肢の羅列に見えて段階だと伝わらないので、1本の軸にしています。
 * `input[type=range]` を使うのはドラッグとキーボード（矢印キー）を自前で書かないため。
 * ただし値そのものではなく**添字**を持たせます。0.33 刻みを step にすると
 * 浮動小数の誤差で右端が選べなくなるためです。
 *
 * ★レイアウトの決めごと：**軸の両端は左右端のラベルの中央**に来ます。
 *   ラベルは全部つまみの中心に合わせた絶対配置で、軸の端は枠から
 *   `--interest-edge`（両端ラベルの半分の幅）だけ内側。こうすると両端のラベルが
 *   枠にちょうど収まり、かつ中央が軸の端の真上に来ます。globals.css 側に計算があります。
 *
 *   位置をインラインで持たせているのは、段階を増やしたときに CSS 側の
 *   nth-child が黙って古いままになるのを避けるためです。段階数は必ずこの配列が正。
 */
function InterestSlider({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const index = interestIndex(value);
  const last = INTEREST_LEVELS.length - 1;
  const at = (i: number) => `calc(var(--interest-edge) + (100% - var(--interest-edge) * 2) * ${i} / ${last})`;

  return (
    <div className="interest-slider" style={{ "--interest-fill": `${(index / last) * 100}%` } as CSSProperties}>
      <div className="interest-track" aria-hidden="true" />
      <input
        type="range"
        className="interest-range"
        min={0}
        max={last}
        step={1}
        value={index}
        onChange={(event) => onChange(INTEREST_LEVELS[Number(event.target.value)].value)}
        aria-label="このニュースへの関心度"
        aria-valuetext={INTEREST_LEVELS[index].label}
      />
      <div className="interest-labels">
        {INTEREST_LEVELS.map((level, i) => (
          <button
            type="button"
            key={level.value}
            className={i === index ? "interest-label selected" : "interest-label"}
            style={{ left: at(i) } as CSSProperties}
            aria-pressed={i === index}
            onClick={() => onChange(level.value)}
          >
            {level.label}
          </button>
        ))}
      </div>
    </div>
  );
}
