import worker from "../src/index.js";

// Cloudflare Pages Functions 入口（catch-all）
// Pages 会优先返回 public/ 下的静态文件，其余请求进入这里。
export const onRequest = (context) => worker.fetch(context.request, context.env, context);
