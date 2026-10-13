import { type ErrorComponentProps, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

// 既定のエラー画面は原因を出さないので、SSR 時にサーバーのログへ残す
function ErrorFallback({ error }: ErrorComponentProps) {
  console.error("画面の描画でエラーが発生しました", error);
  return <p className="error">エラーが発生しました。時間をおいて再読み込みしてください。</p>;
}

export function getRouter() {
  return createRouter({ routeTree, scrollRestoration: true, defaultErrorComponent: ErrorFallback });
}
