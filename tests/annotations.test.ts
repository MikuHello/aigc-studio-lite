import { describe, expect, it } from 'vitest';
import {
  annotationBounds,
  commitAnnotations,
  travelAnnotations,
  type Annotation,
  type AnnotationHistory,
} from '../src/lib/annotations';
const shape: Annotation = {
  id: 'a',
  type: 'rect',
  x: 100,
  y: 200,
  w: -60,
  h: -80,
  color: '#ff0000',
  stroke: 4,
  text: '',
  points: [],
};
describe('annotation editing history', () => {
  it('preserves original geometry through move, undo and redo', () => {
    const first: AnnotationHistory = { past: [], present: [shape], future: [] };
    const moved = commitAnnotations(first, [{ ...shape, x: 400 }]);
    expect(travelAnnotations(moved, 'undo').present).toEqual([shape]);
    expect(travelAnnotations(travelAnnotations(moved, 'undo'), 'redo').present[0].x).toBe(400);
    expect(first.present[0].x).toBe(100);
  });
  it('discards redo only after a new edit and ignores no-op commits', () => {
    const first: AnnotationHistory = { past: [], present: [shape], future: [] };
    const undone = travelAnnotations(commitAnnotations(first, []), 'undo');
    expect(commitAnnotations(undone, [shape])).toBe(undone);
    expect(commitAnnotations(undone, [{ ...shape, color: '#fff' }]).future).toEqual([]);
  });
  it('normalizes bounds for shapes drawn backwards', () => {
    expect(annotationBounds(shape)).toEqual({ x: 40, y: 120, w: 60, h: 80 });
  });
});
