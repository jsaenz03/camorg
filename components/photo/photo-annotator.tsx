'use client';

/**
 * PhotoAnnotator
 *
 * Fullscreen photo annotation editor built directly on react-konva: text,
 * freehand pen, arrows, lines, rectangles and ellipses, with colour, font,
 * font-size and stroke-width pickers, undo/clear, and drag/resize handles
 * (Konva Transformer). Annotations live in natural-image coordinates on a scaled
 * Stage, so saving via stage.toDataURL({ pixelRatio }) exports a
 * full-resolution JPEG with everything flattened in.
 *
 * (Replaced react-filerobot-image-editor: its v5 beta fights this stack —
 * UMD React globals, custom Konva shapes invisible across Turbopack's
 * module instances — which left text unrenderable and exports empty.)
 *
 * Default-exported so the detail dialog can load it via next/dynamic.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import Konva from 'konva';
import {
  Arrow,
  Circle as KonvaCircle,
  Ellipse,
  Group,
  Image as KonvaImage,
  Label,
  Layer,
  Line,
  Rect,
  Stage,
  Tag,
  Text as KonvaText,
  Transformer,
} from 'react-konva';
import {
  ArrowRight,
  Check,
  Circle,
  Loader2,
  Minus,
  MousePointer2,
  Pencil,
  Plus,
  RotateCcw,
  Ruler,
  Square,
  Trash2,
  Type,
  Undo2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { dataUrlToBlob } from '@/lib/utils/image-processing';

// ----- annotation model (all coordinates in natural-image pixels) -----

type Tool = 'select' | 'text' | 'pen' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'measure';

interface BaseAnn {
  id: string;
  color: string;
  strokeWidth: number;
}

interface PenAnn extends BaseAnn {
  type: 'pen';
  points: number[]; // x,y,x,y,...
}

interface TwoPointAnn extends BaseAnn {
  type: 'line' | 'arrow';
  points: [number, number, number, number];
}

/**
 * Calibrated measurement line. The label shows px until the user calibrates
 * (pxPerMm), then mm. Calibration is per-session — it lives only in this
 * editor; the flattened JPEG keeps the printed values.
 */
interface MeasureAnn extends BaseAnn {
  type: 'measure';
  points: [number, number, number, number];
}

interface BoxAnn extends BaseAnn {
  type: 'rect' | 'ellipse';
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TextAnn extends BaseAnn {
  type: 'text';
  x: number;
  y: number;
  text: string;
  fontSize: number;
  fontFamily: string;
}

type Annotation = PenAnn | TwoPointAnn | BoxAnn | TextAnn | MeasureAnn;

/** Loose update shape — callers patch only the fields a shape supports. */
type AnnPatch = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  strokeWidth?: number;
  points?: number[];
};

const PEN_COLORS = ['#dc2626', '#eab308', '#2563eb', '#16a34a', '#ffffff', '#111827'];

// Web-safe stacks only — no font downloads ship with the app.
const TEXT_FONTS = ['Arial', 'Verdana', 'Georgia', 'Times New Roman', 'Courier New'];

const TOOLS: { id: Tool; label: string; icon: typeof Pencil }[] = [
  { id: 'select', label: 'Select / move', icon: MousePointer2 },
  { id: 'text', label: 'Text', icon: Type },
  { id: 'pen', label: 'Pen', icon: Pencil },
  { id: 'arrow', label: 'Arrow', icon: ArrowRight },
  { id: 'line', label: 'Line', icon: Minus },
  { id: 'rect', label: 'Rectangle', icon: Square },
  { id: 'ellipse', label: 'Ellipse', icon: Circle },
  { id: 'measure', label: 'Measure', icon: Ruler },
];

function measurePixelLength(points: [number, number, number, number]): number {
  return Math.hypot(points[2] - points[0], points[3] - points[1]);
}

function measureLabel(ann: MeasureAnn, pxPerMm: number | null): string {
  const px = measurePixelLength(ann.points);
  return pxPerMm ? `${(px / pxPerMm).toFixed(1)} mm` : `${Math.round(px)} px`;
}

function newId() {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Fold a completed drag into the annotation model. For point-based shapes
 * the node's drag offset is baked into the points (position resets to 0,0);
 * for box/text shapes the node position IS the model position.
 */
function bakeDrag(ann: Annotation, node: Konva.Node): AnnPatch {
  if (ann.type === 'pen' || ann.type === 'line' || ann.type === 'arrow' || ann.type === 'measure') {
    const dx = node.x();
    const dy = node.y();
    node.position({ x: 0, y: 0 });
    return { points: ann.points.map((v, i) => v + (i % 2 === 0 ? dx : dy)) };
  }
  if (ann.type === 'ellipse') {
    // Model stores the bounding box; the node's x/y is the ellipse centre.
    return { x: node.x() - ann.width / 2, y: node.y() - ann.height / 2 };
  }
  return { x: node.x(), y: node.y() };
}

/** Fold a completed transformer resize back into the model (scale reset to 1). */
function bakeTransform(ann: Annotation, node: Konva.Node): AnnPatch {
  const sx = node.scaleX();
  const sy = node.scaleY();
  node.scaleX(1);
  node.scaleY(1);
  const growth = (sx + sy) / 2;

  switch (ann.type) {
    case 'text':
      return { x: node.x(), y: node.y(), fontSize: Math.max(8, ann.fontSize * growth) };
    case 'rect':
      return {
        x: node.x(),
        y: node.y(),
        width: Math.max(2, ann.width * sx),
        height: Math.max(2, ann.height * sy),
      };
    case 'ellipse':
      return { width: Math.max(2, ann.width * sx), height: Math.max(2, ann.height * sy) };
    default:
      return {
        strokeWidth: Math.max(1, ann.strokeWidth * growth),
        points: ann.points.map((v, i) => v * (i % 2 === 0 ? sx : sy)),
      };
  }
}

// ----- component -----

interface PhotoAnnotatorProps {
  src: string;
  alt: string;
  onSave: (blob: Blob) => void;
  onClose: () => void;
  isSaving?: boolean;
}

export default function PhotoAnnotator({
  src,
  alt,
  onSave,
  onClose,
  isSaving = false,
}: PhotoAnnotatorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);

  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [view, setView] = useState({ width: 0, height: 0, scale: 1 });
  // User zoom on top of the fitted scale (1 = fit). The stage stays in
  // natural-image coordinates via effScale; zoomed content scrolls.
  const [zoom, setZoom] = useState(1);
  const effScale = view.scale * zoom;
  const zoomIn = () => setZoom((z) => Math.min(8, z * 1.25));
  const zoomOut = () => setZoom((z) => Math.max(0.5, z / 1.25));
  const zoomFit = () => setZoom(1);

  const [tool, setTool] = useState<Tool>('text');
  const [color, setColor] = useState(PEN_COLORS[0]);
  const [font, setFont] = useState(TEXT_FONTS[0]);
  const [textSize, setTextSize] = useState(24);
  const [strokeScale, setStrokeScale] = useState<0 | 1 | 2>(1);

  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [past, setPast] = useState<Annotation[][]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);

  // Calibration scale for the measure tool: natural-image px per mm. Null
  // until the user calibrates against a known reference length.
  const [pxPerMm, setPxPerMm] = useState<number | null>(null);
  const [calibrationMm, setCalibrationMm] = useState('');

  const annotationsRef = useRef<Annotation[]>(annotations);
  annotationsRef.current = annotations;
  const pastRef = useRef<Annotation[][]>(past);
  pastRef.current = past;

  // Load the image, then keep the stage fitted to the container.
  useEffect(() => {
    setZoom(1);
    const img = new Image();
    img.onload = () => setImage(img);
    img.src = src;
  }, [src]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !image) return;

    const fit = () => {
      const pad = 24;
      const availW = Math.max(100, container.clientWidth - pad);
      const availH = Math.max(100, container.clientHeight - pad);
      const scale = Math.min(availW / image.naturalWidth, availH / image.naturalHeight, 1);
      setView({
        width: image.naturalWidth * scale,
        height: image.naturalHeight * scale,
        scale,
      });
    };

    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    return () => observer.disconnect();
  }, [image]);

  const strokeWidth = useMemo(() => {
    if (!image) return 4;
    const base = Math.max(2, Math.round(image.naturalWidth / 400));
    return [base, base * 2, base * 4][strokeScale];
  }, [image, strokeScale]);

  const fontSize = useMemo(
    () => (image ? Math.max(14, Math.round(image.naturalWidth / 28)) : 24),
    [image]
  );

  // Seed/reset the size stepper whenever the fitted image (and its default
  // text size) changes.
  useEffect(() => {
    setTextSize(fontSize);
  }, [fontSize]);

  const pushHistory = useCallback((snapshot: Annotation[]) => {
    setPast((prev) => [...prev.slice(-49), snapshot]);
  }, []);

  const undo = useCallback(() => {
    const prev = pastRef.current;
    if (prev.length === 0) return;
    setAnnotations(prev[prev.length - 1]);
    setPast(prev.slice(0, -1));
    setSelectedId(null);
    setEditingTextId(null);
  }, []);

  // ----- pointer handling (stage coords -> natural coords) -----

  const naturalPoint = useCallback((): { x: number; y: number } | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    const pos = stage.getPointerPosition();
    if (!pos) return null;
    return { x: pos.x / effScale, y: pos.y / effScale };
  }, [effScale]);

  const draftingRef = useRef<Annotation | null>(null);
  const [draft, setDraft] = useState<Annotation | null>(null);

  function handleStagePointerDown(e: Konva.KonvaEventObject<PointerEvent>) {
    if (e.evt.button !== 0) return;
    if (tool === 'select') {
      // Clicking empty space deselects (node clicks cancel the bubble).
      setSelectedId(null);
      return;
    }

    const pt = naturalPoint();
    if (!pt) return;
    const base = { id: newId(), color, strokeWidth };

    if (tool === 'text') {
      // Place a text annotation and open the inline editor immediately.
      const created: TextAnn = {
        ...base,
        type: 'text',
        x: pt.x,
        y: pt.y,
        text: '',
        fontSize: textSize,
        fontFamily: font,
      };
      pushHistory(annotationsRef.current);
      setAnnotations((prev) => [...prev, created]);
      setEditingTextId(created.id);
      setTool('select');
      return;
    }

    let created: Annotation;
    if (tool === 'pen') {
      created = { ...base, type: 'pen', points: [pt.x, pt.y] };
    } else if (tool === 'line' || tool === 'arrow' || tool === 'measure') {
      created = { ...base, type: tool, points: [pt.x, pt.y, pt.x, pt.y] };
    } else {
      created = { ...base, type: tool, x: pt.x, y: pt.y, width: 0, height: 0 };
    }

    draftingRef.current = created;
    setDraft(created);
  }

  function handleStagePointerMove() {
    const current = draftingRef.current;
    if (!current) return;
    const pt = naturalPoint();
    if (!pt) return;

    let next: Annotation;
    switch (current.type) {
      case 'pen':
        next = { ...current, points: [...current.points, pt.x, pt.y] };
        break;
      case 'line':
      case 'arrow':
      case 'measure':
        next = {
          ...current,
          points: [current.points[0], current.points[1], pt.x, pt.y] as [number, number, number, number],
        };
        break;
      case 'rect':
      case 'ellipse':
        next = {
          ...current,
          x: Math.min(current.x, pt.x),
          y: Math.min(current.y, pt.y),
          width: Math.abs(pt.x - current.x),
          height: Math.abs(pt.y - current.y),
        };
        break;
      default:
        return;
    }

    draftingRef.current = next;
    setDraft(next);
  }

  function handleStagePointerUp() {
    const current = draftingRef.current;
    draftingRef.current = null;
    setDraft(null);
    if (!current) return;

    // Discard no-op shapes (a click without a drag).
    switch (current.type) {
      case 'pen':
        if (current.points.length < 4) return;
        break;
      case 'line':
      case 'arrow':
      case 'measure':
        if (current.points[0] === current.points[2] && current.points[1] === current.points[3]) return;
        break;
      case 'rect':
      case 'ellipse':
        if (current.width < 2 || current.height < 2) return;
        break;
      default:
        return;
    }

    pushHistory(annotationsRef.current);
    setAnnotations((prev) => [...prev, current]);
    setSelectedId(current.id);
  }

  // ----- selection / transformer -----

  useEffect(() => {
    const tr = transformerRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;
    const node = selectedId ? stage.findOne(`#${selectedId}`) : null;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedId, annotations, draft, editingTextId]);

  function handleNodeClick(id: string) {
    return (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      e.cancelBubble = true;
      if (tool !== 'select') return;
      setSelectedId(id);
      const ann = annotationsRef.current.find((a) => a.id === id);
      if (ann?.type === 'text') {
        setEditingTextId(id);
      }
    };
  }

  function updateAnnotation(id: string, patch: AnnPatch) {
    setAnnotations((prev) => prev.map((a) => (a.id === id ? ({ ...a, ...patch } as Annotation) : a)));
  }

  /** Font choice seeds new text and restyles a selected text annotation. */
  function handleFontChange(value: string) {
    setFont(value);
    const selected = annotationsRef.current.find((a) => a.id === selectedId);
    if (selected?.type === 'text') {
      updateAnnotation(selected.id, { fontFamily: value });
    }
  }

  /** Size stepper (10% steps): seeds new text and resizes selected text. */
  function handleFontSizeStep(dir: 1 | -1) {
    const step = Math.max(1, Math.round(textSize * 0.1));
    const next = Math.min(999, Math.max(8, textSize + dir * step));
    setTextSize(next);
    const selected = annotationsRef.current.find((a) => a.id === selectedId);
    if (selected?.type === 'text') {
      updateAnnotation(selected.id, { fontSize: next });
    }
  }

  const deleteAnnotation = useCallback(
    (id: string) => {
      pushHistory(annotationsRef.current);
      setAnnotations((prev) => prev.filter((a) => a.id !== id));
      setSelectedId(null);
      setEditingTextId(null);
    },
    [pushHistory]
  );

  // Delete/undo shortcuts (ignored while typing in the text editor).
  useEffect(() => {
    function onKeyDown(e: globalThis.KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing =
        editingTextId !== null ||
        (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT'));
      if (typing) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault();
        deleteAnnotation(selectedId);
      } else if ((e.key === 'z' || e.key === 'Z') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        undo();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId, editingTextId, undo, deleteAnnotation]);

  // ----- text inline editor -----

  const editingAnn = annotations.find(
    (a): a is TextAnn => a.id === editingTextId && a.type === 'text'
  );

  // Focus the text editor only after the placing click fully settles: the
  // browser's click default moves focus to body AFTER pointerdown, which
  // would instantly blur (and discard) an autoFocus'd editor.
  useEffect(() => {
    if (!editingTextId) return;
    const timer = setTimeout(() => {
      document
        .querySelector<HTMLTextAreaElement>('textarea[data-ann-editor]')
        ?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [editingTextId]);

  function commitText(id: string, value: string) {
    setEditingTextId(null);
    const trimmed = value.trim();
    if (!trimmed) {
      setAnnotations((prev) => prev.filter((a) => a.id !== id));
      return;
    }
    updateAnnotation(id, { text: trimmed });
    setSelectedId(id);
  }

  function handleEditorKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>, id: string) {
    if (e.key === 'Escape' || e.key === 'Enter') {
      e.preventDefault();
      commitText(id, e.currentTarget.value);
    }
  }

  // ----- save -----

  function handleSave() {
    const stage = stageRef.current;
    if (!stage || !image) return;

    // Hide selection chrome before flattening.
    transformerRef.current?.nodes([]);
    transformerRef.current?.getLayer()?.batchDraw();

    const url = stage.toDataURL({
      x: 0,
      y: 0,
      width: view.width * zoom,
      height: view.height * zoom,
      pixelRatio: image.naturalWidth / (view.width * zoom),
      mimeType: 'image/jpeg',
      quality: 0.92,
    });
    onSave(dataUrlToBlob(url));
  }

  const canUndo = past.length > 0;
  const cursor = tool === 'select' ? 'default' : 'crosshair';

  const selectedMeasure = annotations.find(
    (a): a is MeasureAnn => a.id === selectedId && a.type === 'measure',
  );

  /** Calibrate px/mm from the selected measure line's known real length. */
  function handleCalibrate() {
    if (!selectedMeasure) return;
    const mm = Number.parseFloat(calibrationMm);
    if (!Number.isFinite(mm) || mm <= 0) return;
    setPxPerMm(measurePixelLength(selectedMeasure.points) / mm);
    setCalibrationMm('');
  }

  function renderNode(ann: Annotation) {
    const interactive = tool === 'select' && editingTextId !== ann.id;
    const shared = {
      id: ann.id,
      stroke: ann.color,
      strokeWidth: ann.strokeWidth,
      hitStrokeWidth: Math.max(ann.strokeWidth * 2, 12),
      listening: interactive,
      draggable: interactive,
      onClick: handleNodeClick(ann.id),
      onTap: handleNodeClick(ann.id),
      onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
        pushHistory(annotationsRef.current);
        updateAnnotation(ann.id, bakeDrag(ann, e.target));
      },
      onTransformEnd: (e: Konva.KonvaEventObject<Event>) => {
        pushHistory(annotationsRef.current);
        updateAnnotation(ann.id, bakeTransform(ann, e.target));
      },
    };

    switch (ann.type) {
      case 'pen':
        return (
          <Line
            key={ann.id}
            {...shared}
            points={ann.points}
            tension={0.2}
            lineCap="round"
            lineJoin="round"
          />
        );
      case 'line':
        return <Line key={ann.id} {...shared} points={ann.points} lineCap="round" />;
      case 'arrow':
        return (
          <Arrow
            key={ann.id}
            {...shared}
            fill={ann.color}
            points={ann.points}
            pointerLength={ann.strokeWidth * 4}
            pointerWidth={ann.strokeWidth * 3}
          />
        );
      case 'measure': {
        const [x1, y1, x2, y2] = ann.points;
        const dot = Math.max(ann.strokeWidth * 1.2, 3);
        const labelFontSize = Math.max(ann.strokeWidth * 4, 12);
        return (
          <Group key={ann.id} {...shared}>
            <Line
              points={ann.points}
              stroke={ann.color}
              strokeWidth={ann.strokeWidth}
              dash={[ann.strokeWidth * 3, ann.strokeWidth * 2]}
              lineCap="round"
              hitStrokeWidth={Math.max(ann.strokeWidth * 2, 12)}
            />
            <KonvaCircle x={x1} y={y1} radius={dot} fill={ann.color} />
            <KonvaCircle x={x2} y={y2} radius={dot} fill={ann.color} />
            <Label
              x={(x1 + x2) / 2}
              y={(y1 + y2) / 2 - labelFontSize}
              offsetY={labelFontSize * 0.4}
            >
              <Tag fill="#000000b3" cornerRadius={4} lineJoin="round" />
              <KonvaText
                text={measureLabel(ann, pxPerMm)}
                fill="#ffffff"
                fontSize={labelFontSize}
                fontStyle="bold"
                padding={labelFontSize * 0.3}
                lineHeight={1}
              />
            </Label>
          </Group>
        );
      }
      case 'rect':
        return (
          <Rect key={ann.id} {...shared} x={ann.x} y={ann.y} width={ann.width} height={ann.height} />
        );
      case 'ellipse':
        return (
          <Ellipse
            key={ann.id}
            {...shared}
            x={ann.x + ann.width / 2}
            y={ann.y + ann.height / 2}
            radiusX={Math.max(ann.width / 2, 1)}
            radiusY={Math.max(ann.height / 2, 1)}
          />
        );
      case 'text':
        return (
          <KonvaText
            key={ann.id}
            {...shared}
            strokeEnabled={false}
            fill={ann.color}
            x={ann.x}
            y={ann.y}
            text={ann.text || ' '}
            fontSize={ann.fontSize}
            fontFamily={ann.fontFamily}
            fontStyle="bold"
          />
        );
    }
  }

  return (
    <div className="flex h-full w-full flex-col bg-background" aria-label={`Annotate ${alt}`}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b bg-card px-3 py-2">
        <div className="flex items-center gap-1 rounded-lg border p-1" role="group" aria-label="Annotation tools">
          {TOOLS.map(({ id, label, icon: Icon }) => (
            <Button
              key={id}
              type="button"
              variant="ghost"
              size="icon"
              aria-label={label}
              aria-pressed={tool === id}
              title={label}
              className={cn('size-8', tool === id && 'bg-accent')}
              disabled={isSaving}
              onClick={() => setTool(id)}
            >
              <Icon className="size-4" />
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-1 rounded-lg border p-1" role="group" aria-label="Colours">
          {PEN_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Colour ${c}`}
              aria-pressed={color === c}
              onClick={() => setColor(c)}
              className={cn(
                'size-5 rounded-full border-2 transition-transform',
                color === c ? 'scale-110 border-foreground' : 'border-border'
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>

        <div className="flex items-center gap-1 rounded-lg border p-1" role="group" aria-label="Font">
          <select
            aria-label="Font"
            title="Font"
            className="h-8 cursor-pointer rounded-md bg-transparent px-1.5 text-sm outline-none"
            value={font}
            disabled={isSaving}
            onChange={(e) => handleFontChange(e.target.value)}
          >
            {TEXT_FONTS.map((f) => (
              <option key={f} value={f} style={{ fontFamily: f }}>
                {f}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1 rounded-lg border p-1" role="group" aria-label="Font size">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Decrease font size"
            title="Decrease font size"
            disabled={isSaving}
            onClick={() => handleFontSizeStep(-1)}
          >
            <Minus className="size-4" />
          </Button>
          <span className="min-w-10 text-center text-sm tabular-nums" title="Font size (image pixels)">
            {textSize}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Increase font size"
            title="Increase font size"
            disabled={isSaving}
            onClick={() => handleFontSizeStep(1)}
          >
            <Plus className="size-4" />
          </Button>
        </div>

        <div className="flex items-center gap-1 rounded-lg border p-1" role="group" aria-label="Stroke width">
          {(['Thin stroke', 'Medium stroke', 'Thick stroke'] as const).map((label, i) => (
            <Button
              key={label}
              type="button"
              variant="ghost"
              aria-label={label}
              aria-pressed={strokeScale === i}
              title={label}
              className={cn('h-8 px-2', strokeScale === i && 'bg-accent')}
              disabled={isSaving}
              onClick={() => setStrokeScale(i as 0 | 1 | 2)}
            >
              <span
                className="rounded-full bg-foreground"
                style={{ width: 4 + i * 4, height: 4 + i * 4 }}
              />
            </Button>
          ))}
        </div>

        {/* Measure calibration */}
        {(selectedMeasure || pxPerMm) && (
          <div
            className="flex items-center gap-1 rounded-lg border p-1"
            role="group"
            aria-label="Measurement calibration"
          >
            {pxPerMm ? (
              <>
                <Ruler className="ml-1 size-4 text-muted-foreground" />
                <span className="whitespace-nowrap px-1 text-xs tabular-nums" title="Pixels per millimetre">
                  1 mm = {pxPerMm.toFixed(1)} px
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  disabled={isSaving}
                  onClick={() => setPxPerMm(null)}
                >
                  Recalibrate
                </Button>
              </>
            ) : selectedMeasure ? (
              <>
                <input
                  type="number"
                  min={0.1}
                  step={0.1}
                  inputMode="decimal"
                  aria-label="Real length of selected measurement line in millimetres"
                  title="Real length of the selected line (mm)"
                  placeholder="mm"
                  value={calibrationMm}
                  onChange={(e) => setCalibrationMm(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCalibrate();
                  }}
                  className="h-8 w-20 rounded-md border bg-transparent px-2 text-sm tabular-nums outline-none"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  disabled={isSaving || !Number.isFinite(Number.parseFloat(calibrationMm))}
                  onClick={handleCalibrate}
                  title="Draw a line along a known length (e.g. a ruler sticker), then enter its real length"
                >
                  Set scale
                </Button>
              </>
            ) : null}
          </div>
        )}

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Undo"
          title="Undo (Cmd+Z)"
          disabled={!canUndo || isSaving}
          onClick={undo}
        >
          <Undo2 className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Clear all annotations"
          disabled={annotations.length === 0 || isSaving}
          onClick={() => {
            pushHistory(annotationsRef.current);
            setAnnotations([]);
            setSelectedId(null);
          }}
        >
          <Trash2 className="size-4" />
        </Button>

        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="outline" disabled={isSaving} onClick={onClose}>
            <X className="size-4" />
            Cancel
          </Button>
          <Button type="button" disabled={isSaving} onClick={handleSave}>
            {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Save annotation
          </Button>
        </div>
      </div>

      {/* Canvas: zoomed content scrolls; auto margins centre it when it fits */}
      <div className="relative flex min-h-0 flex-1 bg-black/90">
        <div ref={containerRef} className="flex min-h-0 flex-1 overflow-auto p-3">
          {image && view.width > 0 && (
            <div className="relative m-auto">
              <Stage
                ref={stageRef}
                width={view.width * zoom}
                height={view.height * zoom}
                scaleX={effScale}
                scaleY={effScale}
                style={{ cursor }}
                onPointerDown={handleStagePointerDown}
                onPointerMove={handleStagePointerMove}
                onPointerUp={handleStagePointerUp}
              >
              <Layer listening={false}>
                <KonvaImage image={image} width={image.naturalWidth} height={image.naturalHeight} />
              </Layer>

              <Layer>
                {[...annotations, ...(draft ? [draft] : [])].map(renderNode)}

                <Transformer
                  ref={transformerRef}
                  rotateEnabled={false}
                  keepRatio={false}
                  borderStroke="#71717a"
                  anchorStroke="#fafafa"
                  anchorFill="#18181b"
                  anchorSize={4 / effScale}
                  borderStrokeWidth={1 / effScale}
                />
              </Layer>
            </Stage>

            {/* Inline text editor overlay */}
            {editingAnn && (
              <textarea
                data-ann-editor={editingAnn.id}
                defaultValue={editingAnn.text}
                onKeyDown={(e) => handleEditorKeyDown(e, editingAnn.id)}
                onBlur={(e) => commitText(editingAnn.id, e.currentTarget.value)}
                className="absolute z-10 min-w-[120px] resize border-2 border-primary bg-background/90 px-1 font-bold outline-none"
                style={{
                  left: editingAnn.x * effScale,
                  top: (editingAnn.y - editingAnn.fontSize * 0.15) * effScale,
                  fontSize: editingAnn.fontSize * effScale,
                  fontFamily: editingAnn.fontFamily,
                  lineHeight: 1.1,
                  color: editingAnn.color,
                  caretColor: editingAnn.color,
                }}
                rows={1}
                aria-label="Annotation text"
              />
            )}
            </div>
          )}
        </div>

        {/* Zoom controls */}
        {image && view.width > 0 && (
          <div className="absolute bottom-3 right-3 flex flex-col items-center gap-1 rounded-lg bg-black/60 p-1 backdrop-blur-sm">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 text-white hover:bg-white/20 hover:text-white"
              aria-label="Zoom in"
              title="Zoom in"
              disabled={isSaving || zoom >= 8}
              onClick={zoomIn}
            >
              <Plus className="size-4" />
            </Button>
            <button
              type="button"
              className="px-1 text-xs tabular-nums text-white"
              title="Current zoom (relative to fit)"
              onClick={zoomFit}
            >
              {Math.round(zoom * 100)}%
            </button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 text-white hover:bg-white/20 hover:text-white"
              aria-label="Reset zoom to fit"
              title="Fit to window"
              disabled={isSaving || zoom === 1}
              onClick={zoomFit}
            >
              <RotateCcw className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 text-white hover:bg-white/20 hover:text-white"
              aria-label="Zoom out"
              title="Zoom out"
              disabled={isSaving || zoom <= 0.5}
              onClick={zoomOut}
            >
              <Minus className="size-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
