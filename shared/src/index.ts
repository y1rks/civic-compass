// db / api / frontend / scripts のすべてから参照する共有定義です。
//
// scripts の .mjs からは相対パスで直接 import します（Node 22 の型ストリップ）。
//
//   import { FRAMES } from "../../shared/src/vocabulary.ts";
//
export * from "./vocabulary";
