'use client';
import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from './Button';
import { useDialogFocus } from './Modal';

interface DrawerProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  locked?: boolean;
}

/** Ngăn kéo bên phải (chi tiết nhanh, biểu mẫu ngắn). */
export function Drawer({ open, title, onClose, children, footer, locked }: DrawerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialogFocus(open, ref, locked ? undefined : onClose);
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="overlay overlay-drawer" onMouseDown={(e) => { if (e.target === e.currentTarget && !locked) onClose(); }}>
      <div ref={ref} className="drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="drawer-head">
          <h2 id={titleId} className="modal-title">{title}</h2>
          <IconButton icon="x" label="Đóng" onClick={onClose} disabled={locked} />
        </div>
        <div className="drawer-body">{children}</div>
        {footer ? <div className="drawer-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
