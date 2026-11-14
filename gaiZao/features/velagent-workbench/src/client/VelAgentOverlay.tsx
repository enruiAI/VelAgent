import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import type { InjectFace, PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import {
  createCanvasSync, NO_CAPABILITIES, type CanvasSyncState, type CanvasSyncStatus,
} from './canvasSync.ts'
import { createWorkspaceProvider, type WorkspaceProvider } from './workspaceBridge.ts'
import { NS } from './locales.ts'
import css from './VelAgentOverlay.module.css'

/** localStorage key holding the dock width. */
const DOCK_STORAGE_KEY = 'velagent.dock'
/** Narrowest dock width the resize handle allows; below this the workbench's file tree crowds out the editor. */
const MIN_DOCK_WIDTH = 760
/** Preferred workbench width on a wide window. */
const PREFERRED_DOCK_WIDTH = 1180
/** Share of the window the dock opens at before the absolute preference applies. */
const DEFAULT_DOCK_WIDTH_RATIO = 0.82
/** Widest share of the window the resize handle allows. */
const MAX_DOCK_WIDTH_RATIO = 0.9

/** Host-injected controls of one dock launcher entry. */
export interface VelAgentDockInjected {
  /** Send the AI-run prompt into the entry's Session; absent outside a Session. */
  readonly sendTrialPrompt?: () => Promise<void>
}

/** Dock geometry remembered across mounts. */
interface DockPreferences {
  /** Panel width in CSS pixels. */
  width: number
}

/** Widest width the current window allows. */
function maximumDockWidth(): number {
  return Math.round(window.innerWidth * MAX_DOCK_WIDTH_RATIO)
}

/** Width the workbench wants on the current window. */
function preferredDockWidth(): number {
  return Math.min(PREFERRED_DOCK_WIDTH, Math.round(window.innerWidth * DEFAULT_DOCK_WIDTH_RATIO))
}

/** Clamp one dock width to the range the current window allows. */
function clampDockWidth(width: number): number {
  // A window narrower than the minimum still caps the dock at its 90% share.
  return Math.min(Math.max(Math.round(width), MIN_DOCK_WIDTH), maximumDockWidth())
}

/** Defaults used when nothing usable is stored. */
function defaultDockPreferences(): DockPreferences {
  return { width: clampDockWidth(preferredDockWidth()) }
}

/** Read the raw persisted dock preference document. */
function readStoredDock(): string | null {
  try {
    return window.localStorage.getItem(DOCK_STORAGE_KEY)
  } catch {
    // Storage can be disabled by browser policy; the dock then uses defaults.
    return null
  }
}

/**
 * Normalize one remembered dock document.
 * @param raw - serialized preferences, absent when nothing was stored.
 * @returns usable preferences, defaulting field by field.
 */
function parseDockPreferences(raw: string | null): DockPreferences {
  if (raw === null) return defaultDockPreferences()
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return defaultDockPreferences()
    const record = parsed as { width?: unknown }
    return typeof record.width === 'number' && Number.isFinite(record.width)
      ? { width: clampDockWidth(record.width) }
      : defaultDockPreferences()
  } catch {
    // Malformed stored JSON falls back to the defaults.
    return defaultDockPreferences()
  }
}

/** Persist one dock preference document. */
function writeDockPreferences(preferences: DockPreferences): void {
  try {
    window.localStorage.setItem(DOCK_STORAGE_KEY, JSON.stringify(preferences))
  } catch {
    // Storage can be disabled by browser policy; the dock keeps working unremembered.
  }
}

/** Localized label and dot class for one bridge status. */
function statusPresentation(
  status: CanvasSyncStatus,
  t: TranslateNS<typeof NS>,
): { label: string; dot: string | undefined } {
  switch (status) {
    case 'connected': return { label: t('status.connected'), dot: css.dotConnected }
    case 'connecting': return { label: t('status.connecting'), dot: css.dotConnecting }
    case 'closed': return { label: t('status.closed'), dot: css.dotClosed }
    case 'error': return { label: t('status.error'), dot: css.dotError }
  }
}

/** Props of the dock panel itself. */
interface VelAgentOverlayProps {
  /** Session owning the workbench; undefined lets the host address its single connected embed. */
  sessionId: string | undefined
  /** Copy of the `velagent` namespace. */
  t: TranslateNS<typeof NS>
  /** Close the panel and return to the launcher. */
  onClose: () => void
  /** Send the AI-run prompt into this Session; absent when the dock opened outside a Session. */
  sendTrialPrompt?: (() => Promise<void>) | undefined
}

/**
 * Resizable right-hand dock hosting the original VelAgent workbench.
 * @param props - session binding, copy, close callback, and AI-run injection.
 */
export function VelAgentOverlay({ sessionId, t, onClose, sendTrialPrompt }: VelAgentOverlayProps) {
  const [dock, setDock] = useState<DockPreferences>(() => parseDockPreferences(readStoredDock()))
  const [canvasState, setCanvasState] = useState<CanvasSyncState>({ status: 'closed', capabilities: NO_CAPABILITIES })
  const containerRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const widthRef = useRef(dock.width)
  const sendTrialRef = useRef<(() => Promise<void>) | undefined>(sendTrialPrompt)
  const status = canvasState.status
  const presentation = statusPresentation(status, t)
  const hasAiRun = sendTrialPrompt !== undefined
  // A connected pre-v3 embed only supplies the bare canvas; say why the workbench is missing.
  const legacyEmbed = status === 'connected' && !canvasState.capabilities.workspace

  useEffect(() => {
    sendTrialRef.current = sendTrialPrompt
  }, [sendTrialPrompt])

  // The bridge lives exactly as long as the open dock: it mounts the original
  // VelAgent workbench, keeps the snapshot/ops link alive, and disposes on close.
  useEffect(() => {
    const container = containerRef.current
    if (container === null) return
    const bridge = createCanvasSync(sessionId === undefined ? {} : { sessionId })
    const unsubscribe = bridge.subscribeState((state) => { setCanvasState(state) })
    setCanvasState(bridge.getState())
    const onAiRun = hasAiRun
      ? (): void => {
          const send = sendTrialRef.current
          if (send === undefined) return
          send().catch((error: unknown) => {
            console.warn('[velagent] AI run injection failed', error)
          })
        }
      : undefined
    // A Session-scoped dock shares that Session's workspace; the footer dock has
    // none, so the workbench keeps its built-in file tree.
    const workspace: WorkspaceProvider | undefined =
      sessionId === undefined ? undefined : createWorkspaceProvider(sessionId)
    bridge.attach(container, {
      ...(onAiRun === undefined ? {} : { onAiRun }),
      ...(workspace === undefined ? {} : { workspace }),
    })
    return () => {
      unsubscribe()
      bridge.dispose()
    }
  }, [sessionId, hasAiRun])

  // Window-level pointer tracking keeps the drag alive outside the handle.
  useEffect(() => {
    const handleMove = (event: PointerEvent): void => {
      const drag = dragRef.current
      if (drag === null) return
      const width = clampDockWidth(drag.startWidth + (drag.startX - event.clientX))
      widthRef.current = width
      setDock((current) => current.width === width ? current : { ...current, width })
    }
    const handleEnd = (): void => {
      if (dragRef.current === null) return
      dragRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      writeDockPreferences({ width: widthRef.current })
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleEnd)
    window.addEventListener('pointercancel', handleEnd)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleEnd)
      window.removeEventListener('pointercancel', handleEnd)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [])

  const startResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    dragRef.current = { startX: event.clientX, startWidth: widthRef.current }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  return createPortal(
    <div
      role="complementary"
      aria-label={t('dock.aria')}
      className={css.dock}
      style={{ width: dock.width }}
    >
      <div
        className={css.resizeHandle}
        role="separator"
        aria-orientation="vertical"
        aria-label={t('dock.resizeAria')}
        onPointerDown={startResize}
      />
      <div className={css.header}>
        <strong className={css.brand}>
          <span aria-hidden="true">⚡ </span>
          {t('dock.title')}
        </strong>
        <span className={css.status} data-status={status}>
          <span className={`${css.dot} ${presentation.dot ?? ''}`} aria-hidden="true" />
          {presentation.label}
        </span>
        <span className={css.spacer} />
        <button type="button" className={css.control} onClick={onClose}>
          {t('dock.close')}
        </button>
      </div>
      {legacyEmbed
        ? <div className={css.notice} role="status">{t('workspace.legacy')}</div>
        : null}
      <div className={css.body}>
        <div ref={containerRef} className={css.workspace} />
        {status !== 'connected'
          ? (
            <div className={css.placeholder} data-status={status}>
              {status === 'error' ? t('canvas.error') : t('canvas.loading')}
            </div>
          )
          : null}
      </div>
    </div>,
    document.body,
  )
}

/** Props of the session-header launcher. */
export type VelAgentHeaderButtonProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<typeof NS>
  & InjectFace<VelAgentDockInjected>

/** Props of the sidebar-footer launcher. */
export type VelAgentFooterButtonProps =
  PropsRuntime<'sidebar.footer.action'> & PropsLocale<typeof NS>

/**
 * Header launcher beside the session mode chip; binds the dock to its Session.
 * @param props - session identity, AI-run injection, and dock copy.
 */
export function VelAgentHeaderButton({ sessionId, t, sendTrialPrompt }: VelAgentHeaderButtonProps) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className={css.launcher}
        title={t('launcher.header.title')}
        onClick={() => { setOpen(true) }}
      >
        <span aria-hidden="true">⚡</span>
        {t('launcher.header.label')}
      </button>
      {open
        ? (
          <VelAgentOverlay
            sessionId={sessionId}
            t={t}
            sendTrialPrompt={sendTrialPrompt}
            onClose={() => { setOpen(false) }}
          />
        )
        : null}
    </>
  )
}

/**
 * Sidebar-footer launcher; root scope has no Session, so the workbench's AI run
 * keeps its local rule.
 * @param props - dock copy.
 */
export function VelAgentFooterButton({ t }: VelAgentFooterButtonProps) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className={css.launcher}
        title={t('launcher.footer.title')}
        onClick={() => { setOpen(true) }}
      >
        <span aria-hidden="true">⚡</span>
        {t('launcher.footer.label')}
      </button>
      {open
        ? <VelAgentOverlay sessionId={undefined} t={t} onClose={() => { setOpen(false) }} />
        : null}
    </>
  )
}
