export type AnnotationTool =
  | 'pen'
  | 'eraser'
  | 'text'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'dashed'
  | 'arrow'
  | 'rect-dashed'
  | 'ellipse-dashed'
  | 'arrow-dashed';
export interface Point {
  x: number;
  y: number;
}
export interface Annotation {
  id: string;
  type: AnnotationTool;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  stroke: number;
  text: string;
  points: Point[];
}
export interface AnnotationHistory {
  past: Annotation[][];
  present: Annotation[];
  future: Annotation[][];
}
export function commitAnnotations(
  history: AnnotationHistory,
  next: Annotation[],
): AnnotationHistory {
  if (JSON.stringify(history.present) === JSON.stringify(next)) return history;
  return { past: [...history.past.slice(-99), history.present], present: next, future: [] };
}
export function travelAnnotations(
  history: AnnotationHistory,
  direction: 'undo' | 'redo',
): AnnotationHistory {
  if (direction === 'undo') {
    const previous = history.past.at(-1);
    return previous
      ? {
          past: history.past.slice(0, -1),
          present: previous,
          future: [history.present, ...history.future],
        }
      : history;
  }
  const next = history.future[0];
  return next
    ? { past: [...history.past, history.present], present: next, future: history.future.slice(1) }
    : history;
}
export function drawAnnotation(ctx: CanvasRenderingContext2D, item: Annotation) {
  const { x, y, w, h, color, stroke, type } = item;
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  if (type === 'pen') ctx.globalAlpha = 0.52;
  if (type === 'eraser') ctx.globalCompositeOperation = 'destination-out';
  ctx.lineWidth = stroke;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (type.endsWith('-dashed') || type === 'dashed') ctx.setLineDash([stroke * 3, stroke * 2]);
  if (type === 'rect' || type === 'rect-dashed') ctx.rect(0, 0, w, h);
  else if (type === 'ellipse' || type === 'ellipse-dashed')
    ctx.ellipse(w / 2, h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
  else if (type === 'text') {
    const lines = item.text.split('\n');
    const fontSize = Math.max(8, Math.abs(h) / (lines.length * 1.25));
    ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    lines.forEach((line, i) =>
      ctx.fillText(line, 0, i * fontSize * 1.25, Math.max(1, Math.abs(w))),
    );
  } else if (type === 'pen' || type === 'eraser') {
    item.points.forEach((point, i) => {
      const px = point.x * w;
      const py = point.y * h;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
  } else {
    ctx.moveTo(0, 0);
    ctx.lineTo(w, h);
    if (type === 'arrow' || type === 'arrow-dashed') {
      ctx.stroke();
      ctx.beginPath();
      ctx.setLineDash([]);
      const angle = Math.atan2(h, w);
      const length = Math.max(16, stroke * 5);
      ctx.moveTo(
        w - length * Math.cos(angle - Math.PI / 6),
        h - length * Math.sin(angle - Math.PI / 6),
      );
      ctx.lineTo(w, h);
      ctx.lineTo(
        w - length * Math.cos(angle + Math.PI / 6),
        h - length * Math.sin(angle + Math.PI / 6),
      );
    }
  }
  ctx.stroke();
  if ((type === 'pen' || type === 'eraser') && item.points.length === 1) {
    ctx.beginPath();
    ctx.arc(item.points[0].x * w, item.points[0].y * h, stroke / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
export function annotationBounds(item: Annotation) {
  return {
    x: Math.min(item.x, item.x + item.w),
    y: Math.min(item.y, item.y + item.h),
    w: Math.abs(item.w),
    h: Math.abs(item.h),
  };
}

// @reason Erase on a separate layer so destination-out cannot remove source image pixels.
export function renderAnnotations(ctx: CanvasRenderingContext2D, items: Annotation[]) {
  const layer = document.createElement('canvas');
  layer.width = ctx.canvas.width;
  layer.height = ctx.canvas.height;
  const overlay = layer.getContext('2d');
  if (!overlay) return;
  overlay.scale(layer.width / 1000, layer.width / 1000);
  items.forEach((item) => drawAnnotation(overlay, item));
  ctx.drawImage(layer, 0, 0);
}
