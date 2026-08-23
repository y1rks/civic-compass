"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, Compass } from "lucide-react";

const NAME_MAX_LENGTH = 30;

export function Onboarding({ status, submitting, error, onSubmit, onRetry }: {
  status: "loading" | "anonymous" | "error";
  submitting: boolean;
  error: string | null;
  onSubmit: (name: string) => Promise<void>;
  onRetry: () => void;
}) {
  const [name, setName] = useState("");
  const normalizedName = name.trim();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (normalizedName.length === 0 || submitting) return;
    void onSubmit(normalizedName);
  };

  return (
    <section className="onboarding-screen" aria-label="ユーザー設定">
      <div className="onboarding-glow" aria-hidden="true" />
      <div className="onboarding-brand">
        <span><Compass size={26} strokeWidth={2.2} /></span>
        <strong>civic-compass</strong>
      </div>

      {status === "loading" && (
        <div className="onboarding-status" role="status">
          <span className="spinner light" />
          <p>利用情報を確認しています</p>
        </div>
      )}

      {status === "error" && (
        <div className="onboarding-card onboarding-error">
          <p className="eyebrow">CONNECTION ERROR</p>
          <h1 id="onboarding-title">利用情報を確認できませんでした</h1>
          <p>通信状況を確認して、もう一度お試しください。</p>
          <button type="button" onClick={onRetry}>もう一度試す</button>
        </div>
      )}

      {status === "anonymous" && (
        <form className="onboarding-card" onSubmit={handleSubmit}>
          <p className="eyebrow">WELCOME</p>
          <h1 id="onboarding-title">はじめまして</h1>
          <p className="onboarding-copy">アプリで使用する名前を入力してください。</p>

          <label htmlFor="onboarding-name">名前</label>
          <input
            id="onboarding-name"
            name="name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={NAME_MAX_LENGTH}
            autoComplete="nickname"
            autoFocus
            placeholder="例：山田 太郎"
            disabled={submitting}
          />
          <div className="onboarding-field-meta">
            <span>{error ?? "あとからマイページに表示されます"}</span>
            <span>{Array.from(name).length}/{NAME_MAX_LENGTH}</span>
          </div>

          <button className="onboarding-submit" type="submit" disabled={normalizedName.length === 0 || submitting}>
            {submitting ? <><span className="button-spinner" /> はじめています</> : <>はじめる <ArrowRight size={17} /></>}
          </button>
          <p className="onboarding-note">このブラウザのCookieを使って、あなたの回答と政治コンパスを保存します。</p>
        </form>
      )}
    </section>
  );
}
