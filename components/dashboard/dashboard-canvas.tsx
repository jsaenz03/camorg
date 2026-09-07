'use client';

/**
 * DashboardCanvas
 *
 * Renders the home dashboard's widgets in a 3-column responsive grid and
 * provides "Customise" mode: drag to reorder, remove widgets, re-add hidden
 * ones, and restore the default layout. The canvas is fully controlled — the
 * page owns the order and persistence.
 *
 * Reordering is pointer-event based (window listeners + rect hit-testing),
 * NOT HTML5 drag & drop: WKWebView (the Tauri shell) cancels in-page drag
 * sessions — and moving the dragged node mid-drag cancels them in Safari
 * even in a normal browser — so the native API never reorders there.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  GripVertical,
  LayoutGrid,
  Plus,
  RotateCcw,
  X,
} from 'lucide-react';
import {
  DASHBOARD_WIDGETS,
  WIDGET_SPAN_CLASSES,
  hiddenDashboardWidgets,
  moveWidget,
  type DashboardWidgetDef,
  type DashboardWidgetId,
} from '@/lib/dashboard-widgets';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

const WIDGET_BY_ID = new Map(DASHBOARD_WIDGETS.map((w) => [w.id, w]));

/** Movement (px) before a press counts as a drag — plain clicks pass through. */
const DRAG_THRESHOLD_PX = 6;
/** Pointer this close to the viewport edge auto-scrolls while dragging. */
const AUTOSCROLL_EDGE_PX = 60;

interface DashboardCanvasProps {
  /** Ordered widget ids to render (already resolved to known ids). */
  value: DashboardWidgetId[];
  editing: boolean;
  /** Live order update (drag swaps, remove, add) — not persisted yet. */
  onChange: (next: DashboardWidgetId[]) => void;
  /** Persist the given order. Fired when a change is complete. */
  onCommit: (next: DashboardWidgetId[]) => void;
  /** Reset to the default layout. */
  onRestoreDefault: () => void;
  renderWidget: (id: DashboardWidgetId) => ReactNode;
}

export function DashboardCanvas({
  value,
  editing,
  onChange,
  onCommit,
  onRestoreDefault,
  renderWidget,
}: DashboardCanvasProps) {
  // Mirror of the live order: pointer events can fire faster than React
  // re-renders, so drag handlers always reorder the freshest list.
  const orderRef = useRef(value);
  orderRef.current = value;

  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  const dragRef = useRef<{
    index: number;
    startX: number;
    startY: number;
    dragging: boolean;
  } | null>(null);
  const dirtyRef = useRef(false);
  // A drag that just ended must not also activate whatever it was released over.
  const suppressClickRef = useRef(false);
  const teardownRef = useRef<(() => void) | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const hidden = hiddenDashboardWidgets(value);

  // Release the window listeners if the canvas unmounts mid-drag.
  useEffect(() => () => teardownRef.current?.(), []);

  function hitTest(x: number, y: number): number | null {
    for (let i = 0; i < itemRefs.current.length; i++) {
      const el = itemRefs.current[i];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) return i;
    }
    return null;
  }

  function handlePointerDown(index: number, e: React.PointerEvent<HTMLElement>) {
    if (!editing || e.button !== 0 || !e.isPrimary || dragRef.current) return;
    // Clear any stale suppression (e.g. a drag aborted by pointercancel/blur,
    // where no click ever fired) — this press's own click must go through.
    suppressClickRef.current = false;
    const startX = e.clientX;
    const startY = e.clientY;
    const drag = { index, startX, startY, dragging: false };
    dragRef.current = drag;

    const onMove = (ev: PointerEvent) => {
      if (!drag.dragging) {
        if (
          Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD_PX
        ) {
          return;
        }
        drag.dragging = true;
        setDraggingIndex(drag.index);
      }

      // Keep widgets below the fold reachable mid-drag.
      if (ev.clientY < AUTOSCROLL_EDGE_PX) window.scrollBy(0, -10);
      else if (ev.clientY > window.innerHeight - AUTOSCROLL_EDGE_PX) {
        window.scrollBy(0, 10);
      }

      const target = hitTest(ev.clientX, ev.clientY);
      if (target === null || target === drag.index) return;
      const next = moveWidget(orderRef.current, drag.index, target);
      orderRef.current = next;
      drag.index = target;
      dirtyRef.current = true;
      setDraggingIndex(target);
      onChange(next);
    };

    const finish = (commit: boolean) => {
      if (drag.dragging) {
        suppressClickRef.current = true;
        if (commit && dirtyRef.current) {
          dirtyRef.current = false;
          onCommit(orderRef.current);
        }
      }
      teardown();
    };
    const onBlur = () => finish(false);

    const teardown = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onBlur);
      dragRef.current = null;
      setDraggingIndex(null);
      teardownRef.current = null;
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onBlur);
    teardownRef.current = teardown;
  }

  function nudge(index: number, delta: -1 | 1) {
    const next = moveWidget(value, index, index + delta);
    onChange(next);
    onCommit(next);
  }

  // ----- add / remove / restore -----

  function removeWidget(id: DashboardWidgetId) {
    const next = value.filter((w) => w !== id);
    onChange(next);
    onCommit(next);
  }

  function addWidget(id: DashboardWidgetId) {
    const next = [...value, id];
    onChange(next);
    onCommit(next);
  }

  return (
    <div>
      <div
        className={cn(
          'grid grid-cols-1 gap-4 lg:grid-cols-3',
          editing && 'select-none',
        )}
      >
        {value.map((id, index) => {
          const def = WIDGET_BY_ID.get(id);
          if (!def) return null;
          return (
            <section
              key={id}
              aria-label={def.label}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              onPointerDown={(e) => handlePointerDown(index, e)}
              // Native drags (imgs/links inside widgets) would compete with
              // pointer dragging — suppress them in edit mode.
              onDragStart={editing ? (e) => e.preventDefault() : undefined}
              onClickCapture={(e) => {
                if (suppressClickRef.current) {
                  suppressClickRef.current = false;
                  e.preventDefault();
                  e.stopPropagation();
                }
              }}
              className={cn(
                WIDGET_SPAN_CLASSES[def.span],
                editing &&
                  'relative cursor-grab touch-none rounded-xl border-2 border-dashed border-primary/40 p-2',
                draggingIndex === index && 'opacity-50',
              )}
            >
              {editing && (
                <>
                  <span className="pointer-events-none absolute -top-3 left-3 z-10 flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-xs text-muted-foreground shadow-sm">
                    <GripVertical className="size-3" aria-hidden />
                    {def.label}
                  </span>
                  <span className="absolute -top-3 right-3 z-10 flex items-center gap-0.5 rounded-full border bg-background p-0.5 shadow-sm">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      aria-label={`Move ${def.label} earlier`}
                      disabled={index === 0}
                      onClick={() => nudge(index, -1)}
                    >
                      <ChevronLeft className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      aria-label={`Move ${def.label} later`}
                      disabled={index === value.length - 1}
                      onClick={() => nudge(index, 1)}
                    >
                      <ChevronRight className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 text-destructive hover:text-destructive"
                      aria-label={`Remove ${def.label} widget`}
                      onClick={() => removeWidget(id)}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </span>
                </>
              )}
              {renderWidget(id)}
            </section>
          );
        })}
      </div>

      {value.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center">
          <LayoutGrid className="size-8 text-muted-foreground" aria-hidden />
          <div>
            <p className="text-sm font-medium">No widgets on the dashboard</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {editing
                ? 'Add one below, or restore the default layout.'
                : 'Restore the default layout to bring them back.'}
            </p>
          </div>
          {!editing && (
            <Button variant="outline" size="sm" onClick={onRestoreDefault}>
              <RotateCcw className="size-4" />
              Restore default dashboard
            </Button>
          )}
        </div>
      )}

      {editing && (
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={hidden.length === 0}>
                <Plus className="size-4" />
                Add widget
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {hidden.length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  All widgets are on the dashboard
                </div>
              ) : (
                hidden.map((w: DashboardWidgetDef) => (
                  <DropdownMenuItem
                    key={w.id}
                    onClick={() => addWidget(w.id)}
                    className="flex flex-col items-start gap-0.5"
                  >
                    <span className="text-sm font-medium">{w.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {w.description}
                    </span>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="sm" onClick={onRestoreDefault}>
            <RotateCcw className="size-4" />
            Restore default
          </Button>
          <p className="text-xs text-muted-foreground">
            Drag widgets to reorder — changes save automatically.
          </p>
        </div>
      )}
    </div>
  );
}
