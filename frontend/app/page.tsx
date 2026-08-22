"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft, ArrowUpRight, Bookmark, Check, ChevronRight, Compass, Heart,
  Home, LockKeyhole, MessageCircle, Sparkles, X,
} from "lucide-react";
import { getArticles, getMatches, getProfileMatches, saveInterest } from "../lib/api";
import type { Article, Match, SavedInterest } from "../lib/types";

type Screen = "feed" | "detail" | "profile";

export default function HomePage() {
  const [screen, setScreen] = useState<Screen>("feed");
  const [articles, setArticles] = useState<Article[]>([]);
  const [visibleCount, setVisibleCount] = useState(5);
  const [selected, setSelected] = useState<Article | null>(null);
  const [comment, setComment] = useState("");
  const [saved, setSaved] = useState<Record<string, SavedInterest>>(() => {
    if (typeof window === "undefined") return {};

    const stored = window.localStorage.getItem("civic-compass-interests");
    if (!stored) return {};

    try {
      return JSON.parse(stored) as Record<string, SavedInterest>;
    } catch {
      return {};
    }
  });
  const [modalOpen, setModalOpen] = useState(false);
  const [matches, setMatches] = useState<Match[]>([]);
  const [profileMatches, setProfileMatches] = useState<Match[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement>(null);

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
    setScreen("detail");
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const interest = await saveInterest(selected.id, comment.trim());
      const next = { ...saved, [selected.id]: interest };
      setSaved(next);
      window.localStorage.setItem("civic-compass-interests", JSON.stringify(next));
      setMatches(await getMatches(selected.id));
      setModalOpen(true);
    } catch (error) {
      console.error("Failed to save interest", error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="app-shell">
      {screen === "feed" && <Feed articles={articles.slice(0, visibleCount)} saved={saved} onOpen={openArticle} loadingMore={loadingMore} loadMoreRef={loadMoreRef} />}
      {screen === "detail" && selected && <ArticleDetail article={selected} comment={comment} setComment={setComment} isSaved={Boolean(saved[selected.id])} saving={saving} onBack={() => setScreen("feed")} onSave={handleSave} />}
      {screen === "profile" && <Profile matches={profileMatches} savedCount={Object.keys(saved).length} />}
      {screen !== "detail" && <BottomNav screen={screen} onChange={setScreen} />}
      {modalOpen && selected && <MatchModal article={selected} matches={matches} onClose={() => setModalOpen(false)} />}
    </main>
  );
}

function Feed({ articles, saved, onOpen, loadingMore, loadMoreRef }: {
  articles: Article[]; saved: Record<string, SavedInterest>; onOpen: (article: Article) => void;
  loadingMore: boolean; loadMoreRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="screen feed-screen">
      <header className="feed-header">
        <div className="brand-row">
          <div className="brand-mark"><Compass size={19} strokeWidth={2.4} /></div>
          <span className="brand-name">civic-compass</span>
          <button className="icon-button" aria-label="保存した記事"><Bookmark size={21} /></button>
        </div>
        <p className="eyebrow">TODAY&apos;S ISSUES</p>
        <h1>今日の論点を、<br />自分の視点で。</h1>
        <p className="header-copy">気になるニュースを選ぶだけで、あなたの考えに近い政治家が見えてきます。</p>
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
                {saved[article.id] && <span className="saved-badge"><Check size={11} /> 関心あり</span>}
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

function ArticleDetail({ article, comment, setComment, isSaved, saving, onBack, onSave }: {
  article: Article; comment: string; setComment: (value: string) => void; isSaved: boolean;
  saving: boolean; onBack: () => void; onSave: () => void;
}) {
  return (
    <div className="screen detail-screen">
      <header className="detail-nav">
        <button className="round-button" onClick={onBack} aria-label="ニュース一覧へ戻る"><ArrowLeft size={21} /></button>
        <span>{article.source}</span>
        <button className="round-button" aria-label="記事を保存"><Bookmark size={20} /></button>
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
      <div className="interest-panel">
        <div className="interest-title"><div><span className="heart-box"><Heart size={18} fill="currentColor" /></span><strong>この記事に関心がありますか？</strong></div><span><LockKeyhole size={12} /> 非公開</span></div>
        <label className="comment-box"><MessageCircle size={18} /><textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={160} placeholder="ひとこと残す（任意）" aria-label="関心についてのコメント" /></label>
        <button className="primary-button" onClick={onSave} disabled={saving}>
          {saving ? <><span className="button-spinner" />保存しています</> : <><Heart size={18} fill="currentColor" />{isSaved ? "内容を更新してマッチを見る" : "関心ありで保存する"}</>}
        </button>
      </div>
    </div>
  );
}

function MatchModal({ article, matches, onClose }: { article: Article; matches: Match[]; onClose: () => void }) {
  return (
    <div className="match-modal" role="dialog" aria-modal="true" aria-label="考えが近い政治家">
      <div className="modal-glow" />
      <header className="modal-header">
        <button className="round-button light" onClick={onClose} aria-label="閉じる"><X size={21} /></button>
        <span>今回のマッチ</span><span className="step-label">1記事目</span>
      </header>
      <div className="modal-content">
        <div className="match-intro">
          <div className="sparkle"><Sparkles size={25} /></div>
          <p className="eyebrow">YOUR PERSPECTIVE</p>
          <h1>あなたと考えが近い<br />3人が見つかりました</h1>
          <p>「{article.category}」への関心をもとに分析</p>
        </div>
        <div className="match-list">
          {matches.map((match, index) => (
            <div className="match-card" key={match.id}>
              <div className="rank">0{index + 1}</div>
              <div className="match-person">
                <div className="politician-avatar" style={{ background: match.color }}>{match.initials}</div>
                <div><h2>{match.name}</h2><p>{match.party}・{match.area}</p></div>
                <div className="match-score"><strong>{match.score}</strong><span>%</span><small>マッチ</small></div>
              </div>
              <div className="score-track"><span style={{ width: `${match.score}%` }} /></div>
              <div className="reason"><span>似ている理由</span><p>{match.reason}</p></div>
            </div>
          ))}
        </div>
        <p className="demo-disclaimer">表示される人物・政党・マッチ結果はすべてデモ用の架空データです。</p>
        <button className="modal-cta" onClick={onClose}>ニュースに戻る <ChevronRight size={18} /></button>
      </div>
    </div>
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
          <div><strong>{savedCount}</strong><span>関心を示した記事</span></div>
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
