/**
 * PartInspectorDialog —— 元件/板卡的属性检查器（原版被裁剪掉了，这里补回一个精简实现）。
 *
 * 用途：
 *  - 点画布上板卡工具栏的齿轮 → 打开板卡信息 + 操作（旋转 / 板卡选项 / 删除）；
 *  - 右键/双击元件 → 打开元件属性（颜色、数值、标签等）；
 *  - 列出引脚，点引脚可直接开始连线。
 *
 * 所有修改都通过 onPropertyChange 交给画布（会进撤销栈）。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentMetadata, PropertyDescriptor } from '../../types/component-metadata';

export interface InspectorAction {
  id: string;
  label: string;
  disabled?: boolean;
  title?: string;
  onSelect: () => void;
}

interface PinInfoLike {
  name: string;
  x?: number;
  y?: number;
}

interface Props {
  componentId: string;
  componentMetadata: ComponentMetadata;
  componentProperties: Record<string, unknown>;
  position: { x: number; y: number };
  pinInfo?: PinInfoLike[];
  previewTagName?: string;
  previewAttributes?: Record<string, unknown>;
  extraActions?: InspectorAction[];
  onClose: () => void;
  onRotate?: (id: string) => void;
  onDelete?: (id: string) => void;
  deleteLabel?: string;
  skipDeleteConfirm?: boolean;
  wireInProgress?: boolean;
  readOnly?: boolean;
  onPropertyChange?: (id: string, propName: string, value: unknown) => void;
  onPinSelect?: (id: string, pinName: string) => void;
}

const PANEL_WIDTH = 340;
const PANEL_MAX_HEIGHT = 560;

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  opacity: 0.65,
  marginBottom: 3,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: '#0f1115',
  color: 'inherit',
  border: '1px solid #2a2e38',
  borderRadius: 5,
  padding: '5px 7px',
  fontSize: 12,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export const PartInspectorDialog: React.FC<Props> = ({
  componentId,
  componentMetadata,
  componentProperties,
  position,
  pinInfo,
  extraActions,
  onClose,
  onRotate,
  onDelete,
  deleteLabel,
  skipDeleteConfirm,
  wireInProgress,
  readOnly,
  onPropertyChange,
  onPinSelect,
}) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pinsOpen, setPinsOpen] = useState(false);

  const width = typeof window === 'undefined' ? PANEL_WIDTH : Math.min(PANEL_WIDTH, window.innerWidth - 24);
  const left = typeof window === 'undefined' ? position.x : clamp(position.x, 12, Math.max(12, window.innerWidth - width - 12));
  const top = typeof window === 'undefined' ? position.y : clamp(position.y - 60, 60, Math.max(60, window.innerHeight - 240));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 只显示真正可编辑的属性：跳过旋转（有单独按钮）和画布内部状态字段。
  const editableProperties = useMemo<PropertyDescriptor[]>(() => {
    const skip = new Set(['rotation', 'state', 'value', 'sdFiles']);
    return (componentMetadata.properties ?? []).filter((prop) => !skip.has(prop.name));
  }, [componentMetadata.properties]);

  const pins = (pinInfo ?? []).filter((pin) => pin && typeof pin.name === 'string');
  const canDelete = Boolean(onDelete);
  const canRotate = Boolean(onRotate) && !readOnly;

  const change = (prop: PropertyDescriptor, raw: string | number | boolean) => {
    if (!onPropertyChange) return;
    let value: unknown = raw;
    if (prop.type === 'number') value = Number(raw);
    onPropertyChange(componentId, prop.name, value);
  };

  const renderEditor = (prop: PropertyDescriptor) => {
    const current = componentProperties?.[prop.name] ?? prop.defaultValue;
    const disabled = Boolean(readOnly) || !onPropertyChange;
    const control = prop.control ?? (prop.type as string);
    if (control === 'boolean' || prop.type === 'boolean') {
      return (
        <input
          type="checkbox"
          checked={Boolean(current)}
          disabled={disabled}
          onChange={(e) => change(prop, e.target.checked)}
        />
      );
    }
    if (control === 'color' || prop.type === 'color') {
      const value = typeof current === 'string' && /^#[0-9a-f]{6}$/i.test(current) ? current : '#ff0000';
      return (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="color"
            value={value}
            disabled={disabled}
            onChange={(e) => change(prop, e.target.value)}
            style={{ width: 34, height: 26, padding: 0, border: '1px solid #2a2e38', background: 'transparent', borderRadius: 4 }}
          />
          <input
            type="text"
            value={String(current ?? '')}
            disabled={disabled}
            onChange={(e) => change(prop, e.target.value)}
            style={inputStyle}
          />
        </div>
      );
    }
    if (control === 'select' || prop.type === 'select') {
      return (
        <select
          value={String(current ?? '')}
          disabled={disabled}
          onChange={(e) => change(prop, e.target.value)}
          style={inputStyle}
        >
          {(prop.options ?? []).map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      );
    }
    if (control === 'range' || prop.type === 'number') {
      const isRange = control === 'range' || (prop.min !== undefined && prop.max !== undefined);
      const value = Number(current) || 0;
      return (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {isRange && (
            <input
              type="range"
              min={prop.min ?? 0}
              max={prop.max ?? 100}
              step={1}
              value={value}
              disabled={disabled}
              onChange={(e) => change(prop, e.target.value)}
              style={{ flex: 1 }}
            />
          )}
          <input
            type="number"
            value={value}
            min={prop.min}
            max={prop.max}
            disabled={disabled}
            onChange={(e) => change(prop, e.target.value)}
            style={{ ...inputStyle, width: 70 }}
          />
        </div>
      );
    }
    return (
      <input
        type="text"
        value={String(current ?? '')}
        disabled={disabled}
        onChange={(e) => change(prop, e.target.value)}
        style={inputStyle}
      />
    );
  };

  const handleDelete = () => {
    if (!onDelete) return;
    if (skipDeleteConfirm || window.confirm('确定删除「' + componentMetadata.name + '」吗？')) {
      onDelete(componentId);
    }
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1200 }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="part-inspector"
        style={{
          position: 'fixed',
          left,
          top,
          width,
          maxHeight: PANEL_MAX_HEIGHT,
          overflow: 'auto',
          background: 'var(--wb-3, #16181d)',
          border: '1px solid var(--wb-7, #2a2e38)',
          borderRadius: 10,
          boxShadow: '0 18px 44px rgba(0, 0, 0, 0.55)',
          color: 'var(--wb-12, #e6e8ee)',
          fontSize: 12,
          padding: 12,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {componentMetadata.name}
            </div>
            <div style={{ opacity: 0.55, fontSize: 11, marginTop: 2 }}>
              {componentMetadata.category}
              {componentMetadata.id ? ' · ' + componentMetadata.id : ''}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            style={{ background: 'transparent', border: 'none', color: 'inherit', opacity: 0.7, cursor: 'pointer', fontSize: 16, lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        {componentMetadata.description && (
          <div style={{ opacity: 0.7, lineHeight: 1.6, marginBottom: 10 }}>{componentMetadata.description}</div>
        )}

        {editableProperties.length > 0 && (
          <div style={{ display: 'grid', gap: 8, marginBottom: 10 }}>
            {editableProperties.map((prop) => (
              <label key={prop.name} style={{ display: 'block' }}>
                <span style={labelStyle}>{prop.name}</span>
                {renderEditor(prop)}
              </label>
            ))}
          </div>
        )}

        {pins.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <button
              type="button"
              onClick={() => setPinsOpen((prev) => !prev)}
              style={{ ...inputStyle, cursor: 'pointer', textAlign: 'left', background: 'transparent', border: '1px solid #2a2e38' }}
            >
              引脚（{pins.length}）{pinsOpen ? ' ▾' : ' ▸'}
            </button>
            {pinsOpen && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                {pins.map((pin) => (
                  <button
                    key={pin.name}
                    type="button"
                    title={onPinSelect ? '点击开始连线' : pin.name}
                    disabled={!onPinSelect || Boolean(wireInProgress)}
                    onClick={() => {
                      onClose();
                      onPinSelect?.(componentId, pin.name);
                    }}
                    style={{
                      padding: '2px 7px',
                      fontSize: 11,
                      borderRadius: 10,
                      border: '1px solid #2a2e38',
                      background: 'transparent',
                      color: 'inherit',
                      cursor: onPinSelect ? 'pointer' : 'default',
                      opacity: onPinSelect ? 0.9 : 0.5,
                    }}
                  >
                    {pin.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {(extraActions ?? []).length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 10 }}>
            {(extraActions ?? []).map((action) => (
              <button
                key={action.id}
                type="button"
                disabled={action.disabled}
                title={action.title}
                onClick={() => {
                  onClose();
                  action.onSelect();
                }}
                style={{ ...inputStyle, cursor: action.disabled ? 'default' : 'pointer', opacity: action.disabled ? 0.5 : 1 }}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 6 }}>
          {onRotate && (
            <button
              type="button"
              disabled={!canRotate}
              onClick={() => onRotate(componentId)}
              style={{ flex: 1, ...inputStyle, cursor: canRotate ? 'pointer' : 'default', opacity: canRotate ? 1 : 0.5 }}
            >
              旋转 90°
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={handleDelete}
              style={{
                flex: 1,
                ...inputStyle,
                cursor: 'pointer',
                color: '#ff8a8a',
                borderColor: '#5a2a2a',
              }}
            >
              {deleteLabel ?? '删除'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
