"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft, ArrowUpRight, Check, ChevronDown, ChevronLeft, Compass,
  ExternalLink, Home, LockKeyhole, MessageCircleMore, Minus, Quote, Sparkles, X,
} from "lucide-react";
import { getAnswers, getArticles, getPerspectives, getProfileMatches, saveAnswer } from "../lib/api";
import type { Article, Match, Perspective, PerspectivePolitician, PerspectiveResult, SavedAnswer } from "../lib/types";
import { DEFAULT_INTEREST, interestLabel } from "../lib/interest";
import { OpinionSheet } from "./opinion-sheet";
import type { Answers } from "./question-block";

type Screen = "feed" | "detail" | "profile";

export default function HomePage() {
  const [screen, setScreen] = useState<Screen>("feed");
  const [articles, setArticles] = useState<Article[]>([]);
  const [visibleCount, setVisibleCount] = useState(5);
  const [selected, setSelected] = useState<Article | null>(null);
  const [comment, setComment] = useState("");
  const [answers, setAnswers] = useState<Answers>({});
  const [interest, setInterest] = useState<number>(DEFAULT_INTEREST);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [saved, setSaved] = useState<Record<string, SavedAnswer>>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [perspectives, setPerspectives] = useState<PerspectiveResult | null>(null);
  const [perspectiveError, setPerspectiveError] = useState(false);
  const [profileMatches, setProfileMatches] = useState<Match[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // オーバーレイの表示中に背景が動くと、閉じた後に記事の位置を見失います。
  // iOS を含めて確実に止めるため、現在位置で body を固定して復元します。
  useEffect(() => {
    if (!sheetOpen && !modalOpen) return;

    const { body, documentElement } = document;
    const scrollY = window.scrollY;
    const previousBodyStyles = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    const previousOverscrollBehavior = documentElement.style.overscrollBehavior;

    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";
    documentElement.style.overscrollBehavior = "none";

    return () => {
      Object.assign(body.style, previousBodyStyles);
      documentElement.style.overscrollBehavior = previousOverscrollBehavior;
      window.scrollTo({ top: scrollY, behavior: "instant" });
    };
  }, [sheetOpen, modalOpen]);

  useEffect(() => {
    let cancelled = false;
    void getArticles()
      .then((nextArticles) => {
        if (!cancelled) setArticles(nextArticles);
      })
      .catch((error: unknown) => console.error("Failed to load articles", error));

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * 保存済みの意見は D1 から読みます。ユーザーの特定はサーバー側で行うので、
   * アカウント切り替えを入れてもこの呼び出しは変わりません。
   *
   * 一覧に戻るたびに読み直すのは、起動時の1回きりだと DB 側の変化に追随できず、
   * 画面が「保存した覚えのない記事」を保存済みとして出し続けるためです。
   */
  useEffect(() => {
    if (screen !== "feed") return;

    let cancelled = false;
    void getAnswers()
      .then((rows) => {
        if (cancelled) return;
        setSaved(Object.fromEntries(rows.map((row) => [row.articleId, row])));
      })
      .catch((error: unknown) => console.error("Failed to load answers", error));

    return () => {
      cancelled = true;
    };
  }, [screen]);

  useEffect(() => {
    const articleIds = Object.keys(saved);
    if (articleIds.length === 0) {
      return;
    }

    let cancelled = false;
    void getProfileMatches(articleIds)
      .then((nextMatches) => {
        if (!cancelled) setProfileMatches(nextMatches);
      })
      .catch((error: unknown) => console.error("Failed to load profile matches", error));

    return () => {
      cancelled = true;
    };
  }, [saved]);

  useEffect(() => {
    if (screen !== "feed" || visibleCount >= articles.length) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting) return;
      setLoadingMore(true);
      window.setTimeout(() => {
        setVisibleCount((count) => Math.min(count + 3, articles.length));
        setLoadingMore(false);
      }, 500);
    }, { rootMargin: "180px" });
    if (loadMoreRef.current) observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [articles.length, screen, visibleCount]);

  const openArticle = (article: Article) => {
    setSelected(article);
    setComment(saved[article.id]?.comment ?? "");
    setAnswers(saved[article.id]?.selections ?? {});
    setInterest(saved[article.id]?.interest ?? DEFAULT_INTEREST);
    setSheetOpen(false);
    setScreen("detail");
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const savedAnswer = await saveAnswer({
        articleId: selected.id,
        interest,
        comment: comment.trim(),
        selections: answers,
      });
      setSaved({ ...saved, [selected.id]: savedAnswer });
      setSheetOpen(false);

      // 議員の発言（evidence）は KV から数MB読むので、待たせずに先に開きます。
      setPerspectives(null);
      setPerspectiveError(false);
      setModalOpen(true);
      void getPerspectives(selected.id)
        .then(setPerspectives)
        .catch((error: unknown) => {
          console.error("Failed to load perspectives", error);
          setPerspectiveError(true);
        });
    } catch (error) {
      console.error("Failed to save answer", error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="app-shell">
      {screen === "feed" && <Feed articles={articles.slice(0, visibleCount)} saved={saved} onOpen={openArticle} loadingMore={loadingMore} loadMoreRef={loadMoreRef} />}
      {screen === "detail" && selected && <ArticleDetail article={selected} isSaved={Boolean(saved[selected.id])} onBack={() => setScreen("feed")} onOpenSheet={() => setSheetOpen(true)} />}
      {sheetOpen && selected && (
        <OpinionSheet
          article={selected}
          interest={interest}
          onInterest={setInterest}
          answers={answers}
          onAnswer={(questionId, stance) => setAnswers((current) => ({ ...current, [questionId]: stance }))}
          comment={comment}
          setComment={setComment}
          saving={saving}
          onCancel={() => setSheetOpen(false)}
          onSave={handleSave}
        />
      )}
      {screen === "profile" && <Profile matches={profileMatches} savedCount={Object.keys(saved).length} />}
      {screen !== "detail" && <BottomNav screen={screen} onChange={setScreen} />}
      {modalOpen && selected && (
        <PerspectiveModal
          article={selected}
          result={perspectives}
          failed={perspectiveError}
          onClose={() => setModalOpen(false)}
        />
      )}
    </main>
  );
}

/**
 * 一覧に出す関心度のバッジ。シートで選んだのと同じ言葉を出します。
 * 「関心がない」で保存した記事を「関心あり」と表示しないための分岐です。
 */
function InterestBadge({ interest }: { interest: number }) {
  const interested = interest > 0;

  return (
    <span className={interested ? "saved-badge" : "saved-badge muted"}>
      {interested ? <Check size={11} /> : <Minus size={11} />} {interestLabel(interest)}
    </span>
  );
}

function Feed({ articles, saved, onOpen, loadingMore, loadMoreRef }: {
  articles: Article[]; saved: Record<string, SavedAnswer>; onOpen: (article: Article) => void;
  loadingMore: boolean; loadMoreRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="screen feed-screen">
      <header className="feed-header">
        <div className="brand-row">
          <div className="brand-mark"><Compass size={19} strokeWidth={2.4} /></div>
          <span className="brand-name">civic-compass</span>
        </div>
        <p className="eyebrow">TODAY&apos;S ISSUES</p>
        <h1>ニュースから、<br />自分の政治を考える。</h1>
        <p className="header-copy">気になる論点を選びながら、<br />あなた自身の考えと近い政治家を見つけよう。</p>
        <div className="privacy-pill"><LockKeyhole size={13} /> 関心データはあなただけに表示されます</div>
      </header>

      <section className="feed-content" aria-label="政治ニュース一覧">
        <div className="section-heading"><div><span className="live-dot" />最新ニュース</div><span>{articles.length}件</span></div>
        <div className="article-list">
          {articles.map((article, index) => (
            <button className={`article-card ${index === 0 ? "featured" : ""}`} key={article.id} onClick={() => onOpen(article)}>
              <div className="article-image-wrap">
                <img src={article.image} alt="" className="article-image" />
                {index === 0 && <span className="top-story">注目</span>}
                {saved[article.id] && <InterestBadge interest={saved[article.id].interest} />}
              </div>
              <div className="article-body">
                <div className="article-meta"><span>{article.category}</span></div>
                <h2>{article.title}</h2>
                {index === 0 && <p>{article.summary}</p>}
                <div className="article-source"><span>{article.source}</span><span>{article.publishedAt}</span></div>
              </div>
            </button>
          ))}
        </div>
        <div className="load-more" ref={loadMoreRef}>{loadingMore && <><span className="spinner" />読み込み中</>}</div>
      </section>
    </div>
  );
}

function ArticleDetail({ article, isSaved, onBack, onOpenSheet }: {
  article: Article; isSaved: boolean; onBack: () => void; onOpenSheet: () => void;
}) {
  return (
    <div className="screen detail-screen">
      <div className="back-layer">
        <button className="round-button" onClick={onBack} aria-label="ニュース一覧へ戻る"><ArrowLeft size={21} /></button>
      </div>
      <header className="detail-nav">
        <span>{article.source}</span>
      </header>
      <article>
        <img className="hero-image" src={article.image} alt="" />
        <div className="article-detail-body">
          <div className="detail-category"><span>{article.category}</span><span>{article.publishedAt}</span></div>
          <h1>{article.title}</h1>
          <p className="lead">{article.summary}</p>
          <div className="byline"><span className="source-avatar">P</span><div><strong>{article.source}</strong><small>政治・社会編集部</small></div></div>
          {article.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          <div className="article-note"><strong>この記事について</strong><br />本画面の記事・数値はUI確認用のサンプルです。実際のサービスでは提供APIの情報を表示します。</div>
        </div>
      </article>
      <div className="fab-layer">
        <button
          className={isSaved ? "fab saved" : "fab"}
          onClick={onOpenSheet}
          aria-label={isSaved ? "この記事への意見を編集する" : "この記事への意見を書く"}
        >
          <MessageCircleMore size={26} />
        </button>
      </div>
    </div>
  );
}

/**
 * 議員のアバター色。`speaker_id` から決めるので、同じ議員はいつも同じ色になります。
 * 「マッチ度」のような意味は持たせません（色で優劣を示さないため）。
 */
const AVATAR_COLORS = ["#527b6b", "#d57a4a", "#68759c", "#7a6a94", "#4d7f8c", "#a06a5c"];

const avatarColor = (speakerId: string) => {
  let hash = 0;
  for (const char of speakerId) hash = (hash * 31 + char.charCodeAt(0)) % 9973;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
};

/** このセル1つでの立場の比較。マッチ度ではないので%は出しません。 */
const ALIGNMENT_LABEL: Record<PerspectivePolitician["alignment"], string | null> = {
  same: "似た立場",
  different: "異なる立場",
  unclear: null,
};

/**
 * B（意見保存直後のポップアップ）。
 *
 * 「あなたと何%似ています」は出しません。**いま答えた論点（frame × target）**を
 * 議員が国会でどう語ってきたかを、発言の原文つきで並べます。
 *
 * ★自分の回答は出しません。合う意見だけを集める画面ではないためです。
 *   「似た立場」と「異なる立場」を最低1人ずつ混ぜて3人出します
 *   （選抜は API 側の classifyByCloseness → pickPoliticians）。
 *
 * 文面はすべて API 側のテンプレートで、引用は会議録の原文そのままです。
 */
function PerspectiveModal({ article, result, failed, onClose }: {
  article: Article; result: PerspectiveResult | null; failed: boolean; onClose: () => void;
}) {
  const perspectives = result?.perspectives ?? [];

  return (
    <div className="match-modal" role="dialog" aria-modal="true" aria-label="この論点についての議員の発言">
      <div className="modal-glow" />
      <header className="modal-header">
        <button className="round-button light" onClick={onClose} aria-label="閉じる"><X size={21} /></button>
        <span>この論点の答弁</span>
        <span className="step-label">{result ? `${perspectives.length}つの論点` : ""}</span>
      </header>
      <div className="modal-content">
        <div className="match-intro">
          <div className="sparkle"><Sparkles size={25} /></div>
          <p className="eyebrow">YOUR PERSPECTIVE</p>
          <h1>この観点をめぐる<br />議員の答弁</h1>
          <p>「{article.category}」の記事で選んだ見方をもとに、国会会議録から抽出</p>
        </div>

        {!result && !failed && (
          <div className="perspective-status"><span className="spinner light" />議員の発言を探しています</div>
        )}
        {failed && (
          <div className="perspective-status">発言を取得できませんでした。時間をおいて試してください。</div>
        )}
        {/* 論点ごとの「見つかりませんでした」は各ブロックが出すので、ここは論点自体が無いときだけ。 */}
        {result && perspectives.length === 0 && (
          <div className="perspective-status">この記事の論点は、まだ議員の発言と結びついていません。</div>
        )}

        <div className="perspective-list">
          {perspectives.map((perspective, index) => (
            <PerspectiveBlock key={perspective.questionId} perspective={perspective} index={index} />
          ))}
        </div>
      </div>

      {/* 免責と戻るボタンは画面下部に固定します。中立性の断りは
          スクロールで流れていってよいものではないためです。 */}
      <div className="modal-footer">
        {result && <p className="demo-disclaimer">{result.disclaimer}</p>}
        <button className="modal-cta" onClick={onClose}><ChevronLeft size={18} /> ニュースに戻る</button>
      </div>
    </div>
  );
}

/**
 * 論点1つ ＝ 記事の設問1つ。見出しは frame × target で、`role` は議員ごとに違うので
 * カード側に出します（設問の role で絞っていないため）。
 */
function PerspectiveBlock({ perspective, index }: { perspective: Perspective; index: number }) {
  return (
    <section className="perspective-block">
      <header className="perspective-head">
        <div className="rank">0{index + 1}</div>
        <p className="perspective-eyebrow">論点</p>
        <h2>{perspective.prompt}</h2>
        {/* 論点は frame × target。role は議員ごとに違うので、カード側に出します。 */}
        <div className="cell-chips">
          <span className="cell-chip">{perspective.target}</span>
          <span className="cell-chip frame">{perspective.frameLabel}</span>
        </div>
      </header>

      {perspective.politicians.length === 0 ? (
        <p className="perspective-empty">この観点で語った発言は見つかりませんでした。</p>
      ) : (
        <div className="speaker-list">
          {/* 立場が分かれなかったときだけ断ります。カードが2枚しか出ない理由になるためです。 */}
          {!perspective.positionsDivided && (
            <p className="speaker-list-note">この観点では、議員の立場に違いがありませんでした。</p>
          )}
          {perspective.politicians.map((politician) => (
            <SpeakerCard
              key={`${politician.speakerId}-${politician.role}`}
              politician={politician}
              target={perspective.target}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/** 同じ議員が role 違いで2枚出ることがあります（守る対象としても脅威としても語った場合）。 */
function SpeakerCard({ politician, target }: { politician: PerspectivePolitician; target: string }) {
  const alignment = ALIGNMENT_LABEL[politician.alignment];

  return (
    <article className="speaker-card">
      <div className="speaker-row">
        <div className="politician-avatar" style={{ background: avatarColor(politician.speakerId) }}>
          {politician.politicianName.slice(0, 1)}
        </div>
        <div className="speaker-name">
          <h3>{politician.politicianName}</h3>
          <p>{politician.party}</p>
        </div>
        {alignment && <span className={`alignment-chip ${politician.alignment}`}>{alignment}</span>}
      </div>

      {/* ★role は消さないこと。「守る対象として」と「問題の原因として」は正反対の思想で、
          畳むと外国人・移民を支援対象として語る議員と脅威として語る議員が同じに見えます。 */}
      <p className={`speaker-role ${politician.role}`}>{target}を{politician.roleLabel}</p>
      <p className="speaker-stance">{politician.stanceText}</p>
      <p className="speaker-mention">{politician.mentionText}（該当する発言 {politician.n}件）</p>

      {/* 答弁そのものは長いので畳んでおきます。まず「誰が・どう扱ったか」を一覧で
          見比べられるようにし、原文は読みたい人だけが開く形にします。
          JS の状態を持たない <details> なので、描画直後から開閉できます。 */}
      <details className="statement-fold">
        <summary>
          <Quote size={11} />
          実際の答弁
          <span className="fold-count">{politician.statements.length}件</span>
          <ChevronDown size={14} className="fold-chevron" />
        </summary>
        <div className="statement-list">
          {politician.statements.map((statement, index) => (
            <div className="statement" key={`${statement.url ?? "no-url"}-${index}`}>
              <div className="statement-meta">
                <span>{statement.quotable ? "国会会議録" : "公式HP"}</span>
                {statement.date && <time>{statement.date}</time>}
              </div>
              {/* 原文を出せるのは会議録（公文書）だけ。公式サイト由来は要約とリンクに留めます。 */}
              {statement.quotable && statement.excerpt
                ? <p className="statement-quote">{statement.excerpt}</p>
                : <p className="statement-summary">{statement.summary}</p>}
              {statement.url && (
                <a className="statement-link" href={statement.url} target="_blank" rel="noreferrer">
                  出典を読む <ExternalLink size={11} />
                </a>
              )}
            </div>
          ))}
        </div>
      </details>
    </article>
  );
}

function Profile({ matches, savedCount }: { matches: Match[]; savedCount: number }) {
  return (
    <div className="screen profile-screen">
      <header className="profile-header">
        <p className="eyebrow">MY PERSPECTIVE</p>
        <h1>あなたの政治コンパス</h1>
        <p>関心を保存するほど、マッチの精度が高まります。</p>
        <div className="profile-stats">
          <div><strong>{savedCount}</strong><span>回答した記事</span></div>
          <div><strong>{savedCount === 0 ? 0 : Math.min(86, 58 + savedCount * 7)}<small>%</small></strong><span>分析の深さ</span></div>
        </div>
      </header>
      <section className="profile-content">
        <div className="section-heading"><div>考えが近い政治家</div><span>総合マッチ</span></div>
        {savedCount === 0 ? (
          <div className="empty-state"><Compass size={30} /><h2>まだ分析データがありません</h2><p>ニュースに関心を示すと、ここにマッチ結果が表示されます。</p></div>
        ) : (
          <div className="profile-match-list">
            {matches.map((match, index) => (
              <a className="profile-match-card" key={match.id} href={match.website} target="_blank" rel="noreferrer">
                <span className="profile-rank">{index + 1}</span>
                <div className="politician-avatar large" style={{ background: match.color }}>{match.initials}</div>
                <div className="profile-match-info"><h2>{match.name}</h2><p>{match.party}・{match.area}</p><div className="mini-track"><span style={{ width: `${match.score}%` }} /></div></div>
                <div className="profile-score"><strong>{match.score}<small>%</small></strong><ArrowUpRight size={16} /></div>
              </a>
            ))}
          </div>
        )}
        <div className="profile-privacy"><LockKeyhole size={20} /><div><strong>あなたの関心は非公開です</strong><p>保存した記事やコメントが、他のユーザーや政治家に公開されることはありません。</p></div></div>
        <p className="demo-disclaimer dark-text">人物・政党・マッチ結果・リンク先はデモ用の架空データです。</p>
      </section>
    </div>
  );
}

function BottomNav({ screen, onChange }: { screen: Screen; onChange: (screen: Screen) => void }) {
  return (
    <nav className="bottom-nav" aria-label="メインナビゲーション">
      <button className={screen === "feed" ? "active" : ""} onClick={() => onChange("feed")}><Home size={21} /><span>ニュース</span></button>
      <button className={`compass-action ${screen === "profile" ? "active" : ""}`} onClick={() => onChange("profile")}><Compass size={21} /><span>政治コンパス</span></button>
    </nav>
  );
}
