// frontend / api の両方からは、このパッケージのルートを import します。
//
//   import { createDb, articles } from "@civic-compass/db";
//
export * from "./schema";
export { createDb, type Db } from "./client";
