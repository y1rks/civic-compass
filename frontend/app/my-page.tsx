import {
  Bell, Bookmark, ChevronRight, CircleHelp, Compass, LockKeyhole, Settings, UserRound,
} from "lucide-react";
import type { CurrentUser } from "../lib/types";

const MENU_ITEMS = [
  { icon: Settings, label: "アカウント設定", detail: "プロフィールや表示名" },
  { icon: Bell, label: "通知設定", detail: "ニュースのお知らせ" },
  { icon: LockKeyhole, label: "プライバシー", detail: "データの取り扱い" },
  { icon: CircleHelp, label: "ヘルプ", detail: "よくある質問" },
];

/**
 * ユーザー名とユーザーIDはD1の値を表示します。
 * 活動サマリーとメニューは、引き続き表示確認用のダミーです。
 */
export function MyPage({ user, status }: {
  user: CurrentUser | null;
  status: "loading" | "ready" | "error";
}) {
  const userName = status === "ready" && user ? user.name : status === "error" ? "ユーザー情報を読み込めませんでした" : "読み込み中";
  const userId = status === "ready" && user ? `ユーザーID：${user.user_id}` : status === "error" ? "時間をおいて再度お試しください" : "ユーザー情報を取得しています";

  return (
    <div className="screen my-page-screen">
      <header className="my-page-header">
        <p className="eyebrow">MY PAGE</p>
        <h1>マイページ</h1>
        <p>あなたの活動と設定をまとめて確認できます。</p>
      </header>

      <section className="my-page-content" aria-label="ユーザー情報">
        <div className="my-page-user-card">
          <div className="my-page-avatar" aria-hidden="true"><UserRound size={30} /></div>
          <div>
            <p className="my-page-user-label">表示名</p>
            <h2>{userName}</h2>
            <p role="status">{userId}</p>
          </div>
        </div>

        <div className="my-page-section-heading">
          <h2>活動サマリー</h2>
        </div>
        <div className="my-page-summary">
          <div><Bookmark size={18} /><strong>12</strong><span>保存した記事</span></div>
          <div><Compass size={18} /><strong>8</strong><span>回答した論点</span></div>
        </div>

        <div className="my-page-section-heading">
          <h2>設定・サポート</h2>
        </div>
        <div className="my-page-menu">
          {MENU_ITEMS.map(({ icon: Icon, label, detail }) => (
            <button type="button" key={label} aria-label={`${label}（デモ表示）`}>
              <span className="my-page-menu-icon"><Icon size={18} /></span>
              <span className="my-page-menu-copy"><strong>{label}</strong><small>{detail}</small></span>
              <ChevronRight size={17} />
            </button>
          ))}
        </div>

        <p className="my-page-footnote">現在は画面確認用のため、各項目は操作できません。</p>
      </section>
    </div>
  );
}
