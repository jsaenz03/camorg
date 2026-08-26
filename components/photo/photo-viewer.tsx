/**
 * PhotoViewer
 *
 * Zoomable, pannable photo surface built on react-zoom-pan-pinch: wheel/pinch
 * zoom, drag to pan, double-click toggles 2×, and floating zoom controls.
 * (Annotation lives in photo-annotator.tsx — the filerobot-based editor.)
 */

'use client';

import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// The library's render-prop children are typed loosely in v3.7's d.ts; we
// only need these three handlers, so narrow them at the boundary.
type ZoomControls = {
  zoomIn: (step?: number) => void;
  zoomOut: (step?: number) => void;
  resetTransform: (animationTime?: number, animationType?: string) => void;
};

interface PhotoViewerProps {
  src: string;
  alt: string;
  className?: string;
}

export function PhotoViewer({ src, alt, className }: PhotoViewerProps) {
  return (
    <div className={cn('relative overflow-hidden rounded-md', className)}>
      <TransformWrapper
        key={src}
        minScale={0.5}
        maxScale={8}
        limitToBounds
        centerOnInit
        doubleClick={{ mode: 'toggle', step: 0.8 }}
        wheel={{ step: 0.15 }}
        panning={{ velocityDisabled: true }}
      >
        {(utils) => {
          const { zoomIn, zoomOut, resetTransform } = utils as unknown as ZoomControls;
          return (
            <>
              {/* The library injects width/height: fit-content on its wrapper
                  and content AFTER Tailwind loads, so h-full/w-full classes
                  lose the cascade and the interactive area shrink-wraps the
                  photo (zoom can never reach the surrounding box). Inline
                  styles win the cascade and force both to fill the viewer. */}
              <TransformComponent
                wrapperClass="h-full w-full"
                wrapperStyle={{ width: '100%', height: '100%' }}
                contentClass="flex h-full w-full items-center justify-center"
                contentStyle={{ width: '100%', height: '100%', display: 'flex' }}
              >
                <div className="relative flex h-full w-full items-center justify-center">
                  {/* w/h-full + object-contain (not max-*): the img element is
                      always exactly the box size and the photo fit-fills it,
                      so it tracks every box resize — max-width would cap it
                      at the photo's intrinsic width ("stuck at load width"). */}
                  {/* eslint-disable-next-line @next/next/no-img-element -- data-URL image from local storage */}
                  <img
                    src={src}
                    alt={alt}
                    draggable={false}
                    className="h-full w-full select-none object-contain"
                  />
                </div>
              </TransformComponent>

              <div className="absolute bottom-3 right-3 flex flex-col gap-1 rounded-lg bg-black/60 p-1 backdrop-blur-sm">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 text-white hover:bg-white/20 hover:text-white"
                  aria-label="Zoom in"
                  onClick={() => zoomIn(0.5)}
                >
                  <Plus className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 text-white hover:bg-white/20 hover:text-white"
                  aria-label="Reset zoom"
                  onClick={() => resetTransform()}
                >
                  <RotateCcw className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 text-white hover:bg-white/20 hover:text-white"
                  aria-label="Zoom out"
                  onClick={() => zoomOut(0.5)}
                >
                  <Minus className="size-4" />
                </Button>
              </div>
            </>
          );
        }}
      </TransformWrapper>
    </div>
  );
}
