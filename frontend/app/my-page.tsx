import {
  Bell, Bookmark, ChevronRight, CircleHelp, Compass, LockKeyhole, Settings, UserRound,
} from "lucide-react";

const MENU_ITEMS = [
  { icon: Settings, label: "アカウント設定", detail: "プロフィールや表示名" },
  { icon: Bell, label: "通知設定", detail: "ニュースのお知らせ" },
  { icon: LockKeyhole, label: "プライバシー", detail: "データの取り扱い" },
  { icon: CircleHelp, label: "ヘルプ", detail: "よくある質問" },
];

/**
 * API 接続前の表示確認用マイページ。
 * 数値・ユーザー情報・メニューはすべて固定のダミー表示です。
 */
export function MyPage() {
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
            <h2>コンパスユーザー</h2>
            <p>civic-compass を利用中</p>
          </div>
          <span className="my-page-demo-badge">デモ</span>
        </div>

        <div className="my-page-section-heading">
          <h2>活動サマリー</h2>
        </div>
        <div className="my-page-summary">
          <div><Bookmark size={18} /><strong>12</strong><span>保存した記事</span></div>
          <div><Compass size={18} /><strong>8</strong><span>回答した論点</span></div>
          <div><Bell size={18} /><strong>3</strong><span>フォロー中</span></div>
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
