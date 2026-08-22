// LLM が返した「原文からの抜き出し」を、元テキスト上の位置に変換する。
//
// なぜこうするか
//   LLM に char_range / evidence_span を数えさせると必ずずれる。抜き出しを返させて
//   こちらで indexOf するほうが正確で、しかも **原文にない引用を機械的に検出できる**。
//   引用が見つからないタグは「推論でタグを付けた」ということなので破棄する。
//   （CLAUDE.personalize.md §6「evidence_span を示せないタグは付けない」の実装）

/** 全角半角・空白・引用符の揺れを吸収した比較用の文字列に変換する */
function normalize(s) {
  return s
    .replace(/[\s　]/g, "")
    .replace(/[「」『』（）()｛｝\[\]【】]/g, "")
    .replace(/[、。，．,.]/g, "")
    .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

/**
 * 正規化した文字列で部分一致を探し、元テキスト上の [start, end) を返す。
 * 厳密一致が取れなかったときのフォールバック。
 */
function findNormalized(haystack, needle) {
  const nNeedle = normalize(needle);
  if (nNeedle.length === 0) return null;

  // 元テキストの各文字が正規化後の何文字目に対応するかを持っておく
  const map = []; // 正規化後の index -> 元テキストの index
  let normalized = "";
  for (let i = 0; i < haystack.length; i++) {
    const n = normalize(haystack[i]);
    for (let k = 0; k < n.length; k++) map.push(i);
    normalized += n;
  }

  const hit = normalized.indexOf(nNeedle);
  if (hit < 0) return null;
  const start = map[hit];
  const endIdx = hit + nNeedle.length - 1;
  const end = (map[endIdx] ?? haystack.length - 1) + 1;
  return [start, end];
}

/** 抜き出し文字列を元テキスト上の位置に変換する */
export function locate(haystack, needle, fromIndex = 0) {
  const exact = haystack.indexOf(needle, fromIndex);
  if (exact >= 0) return { span: [exact, exact + needle.length], match: "exact" };

  const loose = findNormalized(haystack.slice(fromIndex), needle);
  if (loose) return { span: [loose[0] + fromIndex, loose[1] + fromIndex], match: "normalized" };

  return { span: null, match: "not_found" };
}

/**
 * LLM が返したセグメント冒頭のリストを、元テキストの [start, end) 範囲に変換する。
 * 見つからない冒頭は捨てて、前のセグメントに吸収させる。
 */
export function alignSegments(text, heads) {
  const starts = [];
  const dropped = [];
  let cursor = 0;

  for (const head of heads) {
    const { span, match } = locate(text, head, cursor);
    if (!span) {
      dropped.push(head);
      continue;
    }
    starts.push({ at: span[0], match });
    cursor = span[0] + 1;
  }

  // 1つ目は必ず先頭から始める（LLM が前置きを飛ばして返すことがある）
  if (starts.length === 0) starts.push({ at: 0, match: "fallback" });
  else if (starts[0].at !== 0) starts[0] = { at: 0, match: "adjusted" };

  const segments = starts.map((s, i) => ({
    char_range: [s.at, i + 1 < starts.length ? starts[i + 1].at : text.length],
    head_match: s.match,
  }));

  return { segments, dropped };
}

/**
 * 抽出された各フレームの evidence_text を segment 内で探し、
 * 元ブロック上の絶対位置（evidence_span）に変換する。
 * 見つからないフレームは kept: false にする（＝原文にない根拠なので採用しない）。
 */
export function alignEvidence(segmentText, segmentOffset, frames) {
  return frames.map((f) => {
    const { span, match } = locate(segmentText, f.evidence_text ?? "");

    // 表記ゆれで位置を特定できた場合、LLM が返した文字列は原文と1〜数文字ずれている
    // （改行を落とす、括弧を変えるなど）。位置のほうが正確なので、
    // **原文から切り直した文字列で置き換える**。
    // こうしないと UI が evidence_text を表示したとき、原文と食い違う。
    const exactText = span ? segmentText.slice(span[0], span[1]) : f.evidence_text;

    return {
      ...f,
      evidence_text: exactText,
      evidence_span: span ? [segmentOffset + span[0], segmentOffset + span[1]] : null,
      evidence_match: match,
      kept: match !== "not_found",
    };
  });
}
