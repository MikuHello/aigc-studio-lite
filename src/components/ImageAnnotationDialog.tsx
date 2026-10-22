import { FloatingNotice } from './Toasts';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { MousePointer2, Pencil, Type, Square, Eraser, MoveLeft, Undo2, Redo2 } from 'lucide-react';
import { AnnotationColorPicker } from './AnnotationColorPicker';
import type { Asset } from '@/types';
import { Dialog } from './Dialog';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import {
  annotationBounds,
  commitAnnotations,
  renderAnnotations,
  travelAnnotations,
  type Annotation,
  type AnnotationHistory,
  type AnnotationTool,
  type Point,
} from '@/lib/annotations';
import '@/styles/annotations.css';

const SHAPES = [
  ['rect-dashed', '虚线矩形'],
  ['rect', '矩形'],
  ['ellipse-dashed', '虚线圆形'],
  ['ellipse', '圆形'],
] as const;
const LINES = [
  ['dashed', '虚线'],
  ['line', '直线'],
  ['arrow-dashed', '虚线箭头'],
  ['arrow', '箭头'],
] as const;
function ShapeIcon({ type }: { type: AnnotationTool }) {
  const dashed = type.includes('dashed');
  return (
    <svg
      width="21"
      height="21"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {type.startsWith('rect') ? (
        <rect
          x="4"
          y="4"
          width="16"
          height="16"
          rx="2"
          strokeDasharray={dashed ? '3 3' : undefined}
        />
      ) : type.startsWith('ellipse') ? (
        <circle cx="12" cy="12" r="8" strokeDasharray={dashed ? '3 3' : undefined} />
      ) : (
        <>
          <path d="M3 12h18" strokeDasharray={dashed ? '3 3' : undefined} />
          {type.startsWith('arrow') && <path d="m16 7 5 5-5 5" />}
        </>
      )}
    </svg>
  );
}
const COLORS = [
  ['#ffffff', '白色'],
  ['#18181b', '黑色'],
  ['#ef4444', '红色'],
  ['#f97316', '橙色'],
  ['#facc15', '黄色'],
  ['#22c55e', '绿色'],
  ['#06b6d4', '青色'],
  ['#3b82f6', '蓝色'],
  ['#8b5cf6', '紫色'],
  ['#ec4899', '粉色'],
] as const;
type Tool = AnnotationTool | 'select';
interface Gesture {
  start: Point;
  before: Annotation[];
  item: Annotation;
  mode: 'draw' | 'move' | 'resize';
  corner?: number;
  points: Point[];
}

export default function ImageAnnotationDialog({
  asset,
  onClose,
  onComplete,
}: {
  asset?: Asset;
  onClose: () => void;
  onComplete: (dataUrl: string) => void;
}) {
  const [tool, setTool] = useState<Tool>(asset ? 'select' : 'pen');
  const [color, setColor] = useState(asset ? '#ef4444' : '#18181b');
  const [stroke, setStroke] = useState(16);
  const [eraserSize, setEraserSize] = useState(32);
  const [openMenu, setOpenMenu] = useState<'shapes' | 'lines' | null>(null);
  const [lastShape, setLastShape] = useState<AnnotationTool>('rect');
  const [textEntry, setTextEntry] = useState<{
    id?: string;
    point: Point;
    value: string;
    left: number;
    top: number;
    scale: number;
  } | null>(null);
  const textInput = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (textEntry) textInput.current?.focus();
  }, [Boolean(textEntry)]);
  const [eraserCursor, setEraserCursor] = useState<{ x: number; y: number; size: number } | null>(
    null,
  );
  const [history, setHistory] = useState<AnnotationHistory>({ past: [], present: [], future: [] });
  const [draft, setDraft] = useState<Annotation[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const draftRef = useRef<Annotation[] | null>(null);
  const setPreview = (items: Annotation[] | null) => {
    draftRef.current = items;
    setDraft(items);
  };
  const shapeMenu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!openMenu) return;
    const close = (event: globalThis.PointerEvent) => {
      if (!shapeMenu.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [openMenu]);
  const visible = draft ?? history.present;
  const active = visible.find((item) => item.id === selected);
  const sizing = active?.type === 'text';
  const controlLabel = tool === 'eraser' ? '橡皮擦大小' : sizing ? '文字大小' : '线条粗细';
  const controlValue =
    tool === 'eraser'
      ? eraserSize
      : sizing
        ? Math.round(Math.abs(active.h))
        : (active?.stroke ?? stroke);
  const height = image ? (image.naturalHeight / image.naturalWidth) * 1000 : 600;
  const commit = (next: Annotation[]) => setHistory((current) => commitAnnotations(current, next));
  const updateActive = (patch: Partial<Annotation>) => {
    if (active)
      commit(history.present.map((item) => (item.id === selected ? { ...item, ...patch } : item)));
  };
  useEffect(() => {
    let cancelled = false;
    const loaded = new Image();
    loaded.crossOrigin = 'anonymous';
    loaded.onload = () => {
      if (!cancelled) setImage(loaded);
    };
    loaded.onerror = () => {
      if (!cancelled) setError('图片加载失败，请关闭后重试。');
    };
    if (asset) loaded.src = asset.dataUrl;
    else {
      const blank = document.createElement('canvas');
      blank.width = 1536;
      blank.height = 1024;
      const ctx = blank.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, blank.width, blank.height);
      }
      loaded.src = blank.toDataURL('image/png');
    }
    return () => {
      cancelled = true;
    };
  }, [asset?.dataUrl]);
  useEffect(() => {
    const element = canvas.current;
    if (!element || !image) return;
    const ctx = element.getContext('2d');
    if (!ctx) return;
    element.width = image.naturalWidth;
    element.height = image.naturalHeight;
    ctx.drawImage(image, 0, 0);
    renderAnnotations(ctx, visible);
    ctx.scale(image.naturalWidth / 1000, image.naturalWidth / 1000);
    if (active && tool === 'select' && active.type !== 'eraser') {
      const unit = 1000 / Math.max(1, element.getBoundingClientRect().width);
      const handle = 5 * unit;
      const b = annotationBounds(active);
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 1.5 * unit;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(b.x - 3, b.y - 3, b.w + 6, b.h + 6);
      ctx.setLineDash([]);
      for (const [x, y] of [
        [b.x, b.y],
        [b.x + b.w, b.y],
        [b.x + b.w, b.y + b.h],
        [b.x, b.y + b.h],
      ]) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(x - handle, y - handle, handle * 2, handle * 2);
        ctx.strokeRect(x - handle, y - handle, handle * 2, handle * 2);
      }
    }
  }, [image, visible, active, tool]);
  function point(event: PointerEvent<HTMLCanvasElement>): Point {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1000, ((event.clientX - bounds.left) / bounds.width) * 1000)),
      y: Math.max(0, Math.min(height, ((event.clientY - bounds.top) / bounds.height) * height)),
    };
  }
  function start(event: PointerEvent<HTMLCanvasElement>) {
    if (!image || saving || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    const p = point(event);
    const before = history.present;
    if (tool === 'select') {
      if (active) {
        const b = annotationBounds(active);
        const corners = [
          [b.x, b.y],
          [b.x + b.w, b.y],
          [b.x + b.w, b.y + b.h],
          [b.x, b.y + b.h],
        ];
        const corner = corners.findIndex(
          ([x, y]) =>
            Math.hypot(p.x - x, p.y - y) <
            (14 * 1000) / event.currentTarget.getBoundingClientRect().width,
        );
        if (corner >= 0) {
          gesture.current = { start: p, before, item: active, mode: 'resize', corner, points: [] };
          return;
        }
      }
      const hit = [...before].reverse().find((item) => {
        if (item.type === 'eraser') return false;
        const b = annotationBounds(item);
        return p.x >= b.x - 10 && p.x <= b.x + b.w + 10 && p.y >= b.y - 10 && p.y <= b.y + b.h + 10;
      });
      setSelected(hit?.id ?? null);
      if (hit) {
        setColor(hit.color);
        setStroke(hit.stroke);
        gesture.current = { start: p, before, item: hit, mode: 'move', points: [] };
      }
      return;
    }
    setOpenMenu(null);
    if (tool === 'text') {
      const r = event.currentTarget.getBoundingClientRect();
      const parent = event.currentTarget.parentElement!.getBoundingClientRect();
      setSelected(null);
      setTextEntry({
        point: p,
        value: '',
        left: r.left - parent.left + (p.x * r.width) / 1000,
        top: r.top - parent.top + (p.y * r.width) / 1000,
        scale: r.width / 1000,
      });
      return;
    }
    const item: Annotation = {
      id: crypto.randomUUID(),
      type: tool,
      x: p.x,
      y: p.y,
      w: 1,
      h: 1,
      color,
      stroke: tool === 'eraser' ? eraserSize : stroke,
      text: '',
      points: [{ x: 0, y: 0 }],
    };
    setSelected(tool === 'eraser' ? null : item.id);
    gesture.current = { start: p, before, item, mode: 'draw', points: [p] };
    setPreview([...before, item]);
  }
  function move(event: PointerEvent<HTMLCanvasElement>) {
    const g = gesture.current;
    const p = point(event);
    if (tool === 'eraser') {
      const bounds = event.currentTarget.getBoundingClientRect();
      const parent = event.currentTarget.parentElement!.getBoundingClientRect();
      setEraserCursor({
        x: event.clientX - parent.left,
        y: event.clientY - parent.top,
        size: (eraserSize * bounds.width) / 1000,
      });
    }
    if (!g) {
      if (tool === 'select' && active) {
        const b = annotationBounds(active);
        const tolerance = (14 * 1000) / event.currentTarget.getBoundingClientRect().width;
        const corners = [
          [b.x, b.y],
          [b.x + b.w, b.y],
          [b.x + b.w, b.y + b.h],
          [b.x, b.y + b.h],
        ];
        const corner = corners.findIndex(([x, y]) => Math.hypot(p.x - x, p.y - y) < tolerance);
        event.currentTarget.style.cursor =
          corner >= 0 ? (corner % 2 === 0 ? 'nwse-resize' : 'nesw-resize') : 'move';
      }
      return;
    }
    const dx = p.x - g.start.x;
    const dy = p.y - g.start.y;
    let item = { ...g.item };
    if (g.mode === 'move') {
      item.x += dx;
      item.y += dy;
    } else if (g.mode === 'resize') {
      const b = annotationBounds(g.item);
      const c = g.corner!;
      const left = c === 0 || c === 3;
      const top = c === 0 || c === 1;
      const x1 = left ? Math.min(p.x, b.x + b.w - 8) : b.x;
      const y1 = top ? Math.min(p.y, b.y + b.h - 8) : b.y;
      const x2 = left ? b.x + b.w : Math.max(p.x, b.x + 8);
      const y2 = top ? b.y + b.h : Math.max(p.y, b.y + 8);
      item = {
        ...item,
        x: item.w < 0 ? x2 : x1,
        y: item.h < 0 ? y2 : y1,
        w: (x2 - x1) * (item.w < 0 ? -1 : 1),
        h: (y2 - y1) * (item.h < 0 ? -1 : 1),
      };
    } else if (item.type === 'pen' || item.type === 'eraser') {
      g.points.push(p);
      const xs = g.points.map((v) => v.x);
      const ys = g.points.map((v) => v.y);
      item.x = Math.min(...xs);
      item.y = Math.min(...ys);
      item.w = Math.max(1, Math.max(...xs) - item.x);
      item.h = Math.max(1, Math.max(...ys) - item.y);
      item.points = g.points.map((v) => ({
        x: (v.x - item.x) / item.w,
        y: (v.y - item.y) / item.h,
      }));
    } else {
      item.w = dx;
      item.h = dy;
    }
    setPreview(
      g.mode === 'draw' ? [...g.before, item] : g.before.map((v) => (v.id === item.id ? item : v)),
    );
  }
  function end() {
    if (!gesture.current) return;
    if (draftRef.current) commit(draftRef.current);
    gesture.current = null;
    setPreview(null);
  }
  function finishText() {
    if (!textEntry) return history.present;
    setTextEntry(null);
    if (!textEntry.value.trim()) {
      const next = textEntry.id
        ? history.present.filter((item) => item.id !== textEntry.id)
        : history.present;
      commit(next);
      return next;
    }
    const item: Annotation = {
      id: textEntry.id ?? crypto.randomUUID(),
      type: 'text',
      x: textEntry.point.x,
      y: textEntry.point.y,
      w: Math.max(220, ...textEntry.value.split('\n').map((line) => line.length * 32)),
      h: 40 * textEntry.value.split('\n').length,
      color,
      stroke,
      text: textEntry.value,
      points: [],
    };
    const next = textEntry.id
      ? history.present.map((existing) => (existing.id === textEntry.id ? item : existing))
      : [...history.present, item];
    commit(next);
    setSelected(item.id);
    return next;
  }
  async function complete() {
    if (!image || saving) return;
    const items = finishText();
    setSaving(true);
    setError('');
    try {
      await document.fonts.ready;
      const output = document.createElement('canvas');
      output.width = image.naturalWidth;
      output.height = image.naturalHeight;
      const ctx = output.getContext('2d');
      if (!ctx) throw new Error('无法创建图片画布。');
      ctx.drawImage(image, 0, 0);
      renderAnnotations(ctx, items);
      onComplete(output.toDataURL('image/png'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '导出失败，请重试。');
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      open
      onClose={() => {
        if (!saving) onClose();
      }}
      title={asset ? '编辑图片' : '绘图'}
      size="large"
      className="annotation-dialog"
      closeOnBackdrop={false}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button variant="primary" onClick={() => void complete()} disabled={!image || saving}>
            {saving ? '正在导出…' : '完成'}
          </Button>
        </>
      }
    >
      <div
        className="annotation-editor"
        onKeyDown={(event) => {
          if ((event.target as HTMLElement).matches('input, textarea')) return;
          if ((event.metaKey || event.ctrlKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
            event.preventDefault();
            setHistory((h) =>
              travelAnnotations(
                h,
                event.shiftKey || event.key.toLowerCase() === 'y' ? 'redo' : 'undo',
              ),
            );
          }
          if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault();
            commit(history.present.filter((item) => item.id !== selected));
            setSelected(null);
          }
        }}
      >
        <div className="annotation-workspace">
          <div className="annotation-left-rail">
            <label className="annotation-thickness" title={controlLabel}>
              <span className="annotation-width-track">
                <input
                  aria-label={controlLabel}
                  type="range"
                  min={tool === 'eraser' ? '8' : sizing ? '16' : '1'}
                  max={tool === 'eraser' ? '100' : sizing ? '240' : '32'}
                  value={controlValue}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (tool === 'eraser') setEraserSize(value);
                    else if (sizing) {
                      updateActive({
                        h: value,
                        w: (active.w * value) / Math.max(1, Math.abs(active.h)),
                      });
                    } else {
                      setStroke(value);
                      updateActive({ stroke: value });
                    }
                  }}
                />
              </span>
            </label>
            <div className="annotation-history">
              <IconButton
                label="撤销"
                icon={<Undo2 size={19} />}
                disabled={!history.past.length}
                onClick={() => setHistory((h) => travelAnnotations(h, 'undo'))}
              />
              <IconButton
                label="恢复"
                icon={<Redo2 size={19} />}
                disabled={!history.future.length}
                onClick={() => setHistory((h) => travelAnnotations(h, 'redo'))}
              />
            </div>
          </div>
          <div className="annotation-toolbar" role="toolbar" aria-label="标注工具" ref={shapeMenu}>
            {(
              [
                ['select', '选择 / 移动', MousePointer2],
                ['pen', '画笔', Pencil],
                ['text', '文字', Type],
              ] as const
            ).map(([id, label, Icon]) => (
              <IconButton
                key={id}
                label={label}
                icon={<Icon size={20} />}
                aria-pressed={tool === id}
                onClick={() => {
                  setTool(id);
                  setOpenMenu(null);
                  if (id !== 'select') setSelected(null);
                }}
              />
            ))}
            {(['shapes', 'lines'] as const).map((menu) => {
              const options = menu === 'shapes' ? SHAPES : LINES;
              const label = menu === 'shapes' ? '图形' : '线条';
              return (
                <div className="annotation-shapes" key={menu}>
                  <IconButton
                    label={label}
                    icon={menu === 'shapes' ? <Square size={20} /> : <MoveLeft size={20} />}
                    aria-expanded={openMenu === menu}
                    aria-pressed={options.some(([id]) => id === tool)}
                    onClick={() => setOpenMenu(openMenu === menu ? null : menu)}
                  />
                  {openMenu === menu && (
                    <div
                      className="annotation-shape-menu"
                      role="group"
                      aria-label={`${label}工具`}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          event.stopPropagation();
                          setOpenMenu(null);
                        }
                      }}
                    >
                      {options.map(([id, name]) => (
                        <button
                          type="button"
                          key={id}
                          aria-label={name}
                          title={name}
                          aria-pressed={lastShape === id}
                          onClick={() => {
                            setTool(id);
                            setLastShape(id);
                            setSelected(null);
                            setOpenMenu(null);
                          }}
                        >
                          <ShapeIcon type={id} />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            <IconButton
              label="橡皮擦"
              icon={<Eraser size={20} />}
              aria-pressed={tool === 'eraser'}
              onClick={() => {
                setTool('eraser');
                setSelected(null);
                setOpenMenu(null);
              }}
            />
          </div>
          <div className="annotation-stage">
            {image ? (
              <canvas
                ref={canvas}
                aria-label="图片标注画布"
                tabIndex={0}
                style={{
                  aspectRatio: `${image.naturalWidth} / ${image.naturalHeight}`,
                  cursor: tool === 'select' ? 'default' : tool === 'eraser' ? 'none' : 'crosshair',
                }}
                onDoubleClick={(event) => {
                  if (tool !== 'select') return;
                  const r = event.currentTarget.getBoundingClientRect();
                  const parent = event.currentTarget.parentElement!.getBoundingClientRect();
                  const p = {
                    x: ((event.clientX - r.left) / r.width) * 1000,
                    y: ((event.clientY - r.top) / r.width) * 1000,
                  };
                  const hit = [...history.present].reverse().find((item) => {
                    const b = annotationBounds(item);
                    return (
                      item.type === 'text' &&
                      p.x >= b.x &&
                      p.x <= b.x + b.w &&
                      p.y >= b.y &&
                      p.y <= b.y + b.h
                    );
                  });
                  if (hit) {
                    setColor(hit.color);
                    setTextEntry({
                      id: hit.id,
                      point: { x: hit.x, y: hit.y },
                      value: hit.text,
                      left: r.left - parent.left + (hit.x * r.width) / 1000,
                      top: r.top - parent.top + (hit.y * r.width) / 1000,
                      scale: r.width / 1000,
                    });
                  }
                }}
                onPointerLeave={() => setEraserCursor(null)}
                onPointerDown={start}
                onPointerMove={move}
                onPointerUp={end}
                onPointerCancel={() => {
                  gesture.current = null;
                  setPreview(null);
                }}
              />
            ) : (
              <p>正在加载图片…</p>
            )}
            {textEntry && (
              <textarea
                ref={textInput}
                className="annotation-inline-text"
                aria-label="图上文字"
                placeholder="输入文字"
                value={textEntry.value}
                style={{
                  left: textEntry.left,
                  top: textEntry.top,
                  color,
                  fontSize: 32 * textEntry.scale,
                  lineHeight: '1.25',
                  width: Math.max(
                    120,
                    Math.min(
                      360,
                      (textEntry.value
                        .split('\n')
                        .reduce((max, line) => Math.max(max, line.length), 0) *
                        32 +
                        32) *
                        textEntry.scale,
                    ),
                  ),
                  height: Math.max(
                    32,
                    textEntry.value.split('\n').length * 40 * textEntry.scale + 8,
                  ),
                }}
                onChange={(event) => setTextEntry({ ...textEntry, value: event.target.value })}
                onBlur={() => finishText()}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setTextEntry(null);
                  }
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    finishText();
                  }
                }}
              />
            )}
            {tool === 'eraser' && eraserCursor && (
              <span
                className="annotation-eraser-cursor"
                style={{
                  left: eraserCursor.x,
                  top: eraserCursor.y,
                  width: eraserCursor.size,
                  height: eraserCursor.size,
                }}
              />
            )}
          </div>
        </div>
        <div className="annotation-palette" role="group" aria-label="颜色">
          <AnnotationColorPicker
            value={active?.color ?? color}
            onChange={(value) => {
              setColor(value);
              updateActive({ color: value });
            }}
          />
          {COLORS.map(([value, label]) => (
            <button
              type="button"
              key={value}
              className="annotation-swatch"
              style={{ background: value }}
              aria-label={label}
              aria-pressed={(active?.color ?? color).toLowerCase() === value}
              onClick={() => {
                setColor(value);
                updateActive({ color: value });
              }}
            />
          ))}
        </div>
        <FloatingNotice message={error || null} />
      </div>
    </Dialog>
  );
}
