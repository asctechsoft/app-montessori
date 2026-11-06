'use client';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import { Banner } from './Banner';

const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Đưa focus vào hộp thoại, giữ focus trong hộp, Esc để đóng, trả focus về vị trí cũ khi đóng. */
export function useDialogFocus(open: boolean, ref: React.RefObject<HTMLElement | null>, onClose?: () => void) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('[data-autofocus]') ?? el?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? el)?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current?.();
        return;
      }
      if (e.key !== 'Tab' || !el) return;
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const firstEl = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      previous?.focus?.();
    };
  }, [open, ref]);
}

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg';
  /** Chặn đóng bằng Esc/nhấp nền (vd. khi đang gửi). */
  locked?: boolean;
}

export function Modal({ open, title, onClose, children, footer, size = 'md', locked }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialogFocus(open, ref, locked ? undefined : onClose);
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !locked) onClose(); }}>
      <div ref={ref} className={`modal ${size === 'lg' ? 'modal-lg' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <h2 className="modal-title" id={titleId}>{title}</h2>
        {children}
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** Đối tượng bị tác động (tên cơ sở, người dùng, kỳ...). */
  subject?: string;
  /** Các tác động sẽ xảy ra, nêu cụ thể (người dùng PHẢI xem trước khi xác nhận). */
  impact: string[];
  /** Nhãn nút xác nhận: động từ + đối tượng, vd. "Thu hồi quyền của Lan". */
  confirmLabel: string;
  cancelLabel?: string;
  /** destructive chỉ khi làm mất quyền/dữ liệu; thao tác chỉ quay lại không dùng đỏ. */
  tone?: 'primary' | 'destructive';
  busy?: boolean;
  /** Lỗi từ máy chủ: hiện trong hộp thoại, không đóng, không báo thành công. */
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}

/** Hộp thoại XEM TÁC ĐỘNG: nêu đối tượng + tác động; nút busy chặn xác nhận hai lần; chỉ đóng khi gọi onCancel. */
export function ConfirmDialog({
  open, title, subject, impact, confirmLabel, cancelLabel = 'Quay lại', tone = 'primary', busy, error, onConfirm, onCancel, children,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      locked={busy}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy} data-autofocus>{cancelLabel}</Button>
          <Button variant={tone === 'destructive' ? 'destructive' : 'primary'} onClick={onConfirm} loading={busy}>{confirmLabel}</Button>
        </>
      }
    >
      <div className="impact">
        {subject ? <div className="impact-subject">{subject}</div> : null}
        <div className="text-small text-secondary">Tác động khi xác nhận:</div>
        <ul>
          {impact.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      </div>
      {children}
      {error ? <Banner tone="error">{error}</Banner> : null}
    </Modal>
  );
}
