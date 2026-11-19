/** VelAgent workbench panel: session-header and sidebar-footer launchers that open the workbench dock. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  VelAgentFooterButton, VelAgentHeaderButton, type VelAgentDockInjected,
} from './VelAgentOverlay.tsx'
import { en, NS, zh, type VelagentKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** VelAgent workbench dock chrome and launcher copy. */
    'velagent': VelagentKey
  }
}

/** Minimal client Sessions surface the AI-run injection reads. */
interface ClientSessions {
  /**
   * Borrow one Session's Agent-scoped context.
   * @param sessionId - target Session identity.
   * @returns the live scoped context, or undefined without a retained generation.
   */
  scope(sessionId: string): ClientSessionScope | undefined
}

/** Minimal Agent-scoped context surface the AI-run injection reads. */
interface ClientSessionScope {
  /**
   * Read the scope-addressed Conversation service.
   * @param name - service name.
   * @returns the Conversation action face, or undefined before it loads.
   */
  get(name: 'conversation'): ConversationSender | undefined
}

/** The part of the scope-addressed Conversation service this plugin uses. */
interface ConversationSender {
  /**
   * Queue one prompt turn into the scoped Session.
   * @param text - prompt text.
   */
  send(text: string): Promise<void>
}

/**
 * Whether one value exposes the client Sessions scope method the AI run calls.
 *
 * This package compiles its host and client halves in one TypeScript program, so
 * the host SessionStore declaration shadows the client service type at
 * `ctx.sessions`; the browser value is the client Sessions service.
 * @param value - value read from the `sessions` service slot.
 * @returns whether it exposes `scope` as a function.
 */
function isClientSessions(value: unknown): value is ClientSessions {
  if (typeof value !== 'object' || value === null) return false
  return typeof (value as { readonly scope?: unknown }).scope === 'function'
}

/**
 * Read the client Sessions service.
 * @param ctx - Client root context.
 * @returns the narrowed client Sessions surface.
 * @throws when the service is missing or is not the client Sessions implementation.
 */
function clientSessions(ctx: ClientContext): ClientSessions {
  const value: unknown = ctx.get('sessions')
  if (!isClientSessions(value)) throw new Error('ui-velagent: client Sessions service unavailable')
  return value
}

/** Required services: the UI slot registry, the locale dictionaries, and Session scopes. */
export const inject = ['slots', 'locale', 'sessions']

/**
 * Register the VelAgent launchers into the session header and the sidebar footer.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-velagent: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'velagent-workbench',
    locale: NS,
    inject: (sessionId): VelAgentDockInjected => ({
      sendTrialPrompt: async () => {
        const scoped = clientSessions(ctx).scope(sessionId)
        if (scoped === undefined) throw new Error(`ui-velagent: session "${String(sessionId)}" resolved no scope`)
        const conversation = scoped.get('conversation')
        if (conversation === undefined) throw new Error('ui-velagent: conversation service unavailable')
        await conversation.send(t('aiRun.prompt'))
      },
    }),
  }, VelAgentHeaderButton))
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'velagent',
    locale: NS,
  }, VelAgentFooterButton))
}
