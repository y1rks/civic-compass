// 議員マスタ（politicians.json）と政党マスタ（parties.json）を同じ形で読むための層。
//
// 公約の収集・前処理・抽出は、議員の公式サイトを扱う経路とまったく同じ処理でよい
// （どちらも「文書を見出しで区切って LLM にかける」だけ）。違うのは対象の一覧だけなので、
// スクリプト側は --target=parties を受け取ってこの関数から一覧を得る。
//
// ★ id / name の対応
//     議員  id = speaker_id  name = 氏名
//     政党  id = party_id    name = 政党名（profile:party:{name} のキーでもある）
//
//   出力ファイルは data/raw_web/{id}.jsonl のように id で分かれる。
//   P00001 と PT01 は衝突しないので、議員と政党で同じディレクトリを使う。

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** --target= で指定できる値。既定は議員（既存のコマンドラインを変えないため） */
export const TARGET_KINDS = ["politicians", "parties"];

export function parseTarget(value) {
  if (!TARGET_KINDS.includes(value)) {
    throw new Error(`--target は ${TARGET_KINDS.join(" | ")} のいずれかです: ${value}`);
  }
  return value;
}

/**
 * マスタを共通の形で返す。
 *
 * entries[].raw に元のレコードを残してあるので、議員固有の項目
 * （expected_groups / collect_from など）が要る処理はそこから読む。
 */
export async function loadMaster(target = "politicians") {
  if (target === "politicians") {
    const master = JSON.parse(await readFile(path.join(ROOT, "scripts/kokkai/politicians.json"), "utf8"));
    return {
      target,
      kind: "politician",
      extract_window: master.extract_window,
      entries: master.politicians.map((p) => ({
        id: p.speaker_id,
        name: p.name,
        // 発言時点の党籍は preprocess が API の値から入れる。ここは現所属。
        party: p.party,
        house: p.house ?? null,
        website: p.website ?? null,
        web_sources: p.web_sources ?? [],
        web_note: p.web_note ?? null,
        extract_from: p.extract_from ?? null,
        extract_to: p.extract_to ?? null,
        active: p.active !== false,
        raw: p,
      })),
      raw: master,
    };
  }

  const master = JSON.parse(await readFile(path.join(ROOT, "scripts/kokkai/parties.json"), "utf8"));
  return {
    target,
    kind: "party",
    extract_window: master.extract_window,
    entries: master.parties.map((p) => ({
      id: p.party_id,
      name: p.name,
      // 政党自身が発言主体なので、党籍は自分の名前になる。
      party: p.name,
      house: null,
      website: p.website ?? null,
      web_sources: p.web_sources ?? [],
      web_note: p.web_note ?? null,
      extract_from: p.extract_from ?? null,
      extract_to: p.extract_to ?? null,
      active: p.active !== false,
      raw: p,
    })),
    raw: master,
  };
}
