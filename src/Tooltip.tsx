import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';

const TOOLTIP_MARGIN = 8;
const HOVER_DELAY_MS = 300;

export function pickTooltipSide(anchorTop: number, tooltipH: number, margin: number): 'top' | 'bottom' {
  return anchorTop - tooltipH - margin < 0 ? 'bottom' : 'top';
}

type TooltipProps = {
  label: string;
  children: ReactElement;
};

export function Tooltip({ label, children }: TooltipProps) {
  const id = useId();
  const tooltipId = `tooltip-${id.replace(/:/g, '')}`;
  const [visible, setVisible] = useState(false);
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: 'hidden' });
  const anchorRef = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viaFocus = useRef(false);

  const clearTimer = useCallback(() => {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  }, []);

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    const tip = tipRef.current;
    if (!anchor || !tip) return;
    const rect = anchor.getBoundingClientRect();
    const tipH = tip.offsetHeight;
    const tipW = tip.offsetWidth;
    const side = pickTooltipSide(rect.top, tipH, TOOLTIP_MARGIN);
    const left = rect.left + rect.width / 2 - tipW / 2;
    const top = side === 'top' ? rect.top - tipH - TOOLTIP_MARGIN : rect.bottom + TOOLTIP_MARGIN;
    const clampedLeft = Math.max(8, Math.min(left, window.innerWidth - tipW - 8));
    setStyle({ top, left: clampedLeft, visibility: 'visible' });
  }, []);

  const hide = useCallback(() => {
    clearTimer();
    setVisible(false);
    viaFocus.current = false;
  }, [clearTimer]);

  const show = useCallback(
    (immediate: boolean) => {
      clearTimer();
      const run = () => setVisible(true);
      if (immediate) run();
      else hoverTimer.current = setTimeout(run, HOVER_DELAY_MS);
    },
    [clearTimer],
  );

  useLayoutEffect(() => {
    if (!visible) return;
    updatePosition();
  }, [visible, label, updatePosition]);

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    const onScroll = () => updatePosition();
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [visible, hide, updatePosition]);

  const mergeRef = (node: HTMLElement | null) => {
    anchorRef.current = node;
    const childRef = (children as ReactElement & { ref?: React.Ref<HTMLElement> }).ref;
    if (typeof childRef === 'function') childRef(node);
    else if (childRef && typeof childRef === 'object') {
      (childRef as React.MutableRefObject<HTMLElement | null>).current = node;
    }
  };

  const child = cloneElement(children, {
    ref: mergeRef,
    'aria-describedby': visible ? tooltipId : undefined,
    onMouseEnter: (e: MouseEvent) => {
      children.props.onMouseEnter?.(e);
      viaFocus.current = false;
      show(false);
    },
    onMouseLeave: (e: MouseEvent) => {
      children.props.onMouseLeave?.(e);
      if (!viaFocus.current) hide();
    },
    onFocus: (e: FocusEvent) => {
      children.props.onFocus?.(e);
      viaFocus.current = true;
      show(true);
    },
    onBlur: (e: FocusEvent) => {
      children.props.onBlur?.(e);
      hide();
    },
  });

  return (
    <>
      {child}
      {visible &&
        createPortal(
          <div ref={tipRef} id={tooltipId} role="tooltip" className="ui-tooltip" style={style}>
            {label}
          </div>,
          document.body,
        )}
    </>
  );
}
