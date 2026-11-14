/**
 * VelAgent brand layer, browser half.
 *
 * Registers the official sidebar brand slots with VelAgent artwork (the slot
 * registration replaces the official fallback while the row is active) and
 * points the browser favicon at the VelAgent chip icon served by the workbench
 * plugin's asset route.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'

/** Chip-icon favicon served by the workbench asset route. */
const FAVICON_URL = '/velagent-assets/favicon.svg'

/** Inline brand glyph; keeps the bundle self-contained (no extra asset file). */
const BRAND_GLYPH =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="#8b5cf6"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs>' +
      '<rect x="6" y="6" width="52" height="52" rx="14" fill="url(#g)"/>' +
      '<path d="M26 16h12v10h10v12H38v10H26V38H16V26h10z" fill="#ffffff" opacity="0.92"/>' +
    '</svg>',
  )

/** Required slot service. */
export const inject = ['slots']

/**
 * Register the VelAgent brand into the sidebar and swap the favicon.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.brand.name', () =>
    ctx.slots.register({ name: 'sidebar.brand.name' }, BrandName),
  )
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.register({ name: 'sidebar.brand.mark' }, BrandMark),
  )
  installFavicon()
}

/** Sidebar product name. */
function BrandName() {
  return <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>VelAgent</span>
}

/** Sidebar brand mark. */
function BrandMark() {
  return <img src={BRAND_GLYPH} alt="VelAgent" width={20} height={20} style={{ display: 'block', flex: 'none', borderRadius: 5 }} />
}

/** Point the document favicon links at the VelAgent icon. */
function installFavicon(): void {
  if (typeof document === 'undefined' || document.head === null) return
  const links = document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')
  if (links.length === 0) {
    const link = document.createElement('link')
    link.rel = 'icon'
    link.type = 'image/svg+xml'
    link.href = FAVICON_URL
    document.head.appendChild(link)
    return
  }
  for (const link of links) {
    link.href = FAVICON_URL
    link.type = 'image/svg+xml'
  }
}
