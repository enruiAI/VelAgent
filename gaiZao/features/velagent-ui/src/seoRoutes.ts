/**
 * 精简版没有营销/SEO 路由表（原 seoRoutes 是 velxio.dev 的落地页清单，
 * 由 pro 覆盖层提供）。保留类型与空表，useSEO 的 canonical/hreflang 逻辑照常运行。
 */
export interface SEORoute {
  path: string;
  noindex?: boolean;
}

export const SEO_ROUTES: SEORoute[] = [];
