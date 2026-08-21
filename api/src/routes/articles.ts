import { Hono } from "hono";
import type { AppEnv } from "../bindings";
import { articles as articleStub } from "../data/articles";

const articles = new Hono<AppEnv>();

articles.get("/", (c) => c.json({ articles: articleStub }));

export default articles;
