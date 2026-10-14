// The dialog frame used by every dialog, and a labelled field.
import { useEffect, useRef, type FormEvent, type ReactNode } from 'react';
import { S } from './store';
import Icon from './Icon';

export function Modal({ title, children, onOk, okLabel = 'OK', cancelLabel = 'Cancel', noOk, wide, xwide, extra }: {
  title: string; children: ReactNode; onOk?: () => boolean | void; okLabel?: string; cancelLabel?: string; noOk?: boolean; wide?: boolean; xwide?: boolean; extra?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = () => S().close();
  useEffect(() => { const d = ref.current!; if (!d.open) d.showModal(); }, []);
  const submit = (e: FormEvent) => { e.preventDefault(); if (onOk && onOk() === false) return; close(); };
  return (
    <dialog ref={ref} className={xwide ? 'xwide' : wide ? 'wide' : ''} onCancel={e => { e.preventDefault(); close(); }}>
      <form onSubmit={submit}>
        <div className="dlg-head"><h2>{title}</h2><button type="button" className="x" aria-label="Close" onClick={close}><Icon name="x" /></button></div>
        <div className="dlg-body">{children}</div>
        <div className="dlg-foot">{extra}<span className="sp" />{!noOk && <button type="submit" className="btn primary">{okLabel}</button>}<button type="button" className="btn" onClick={close}>{cancelLabel}</button></div>
      </form>
    </dialog>
  );
}

export const F = ({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) => <label className={'fld' + (wide ? ' wide' : '')}><span>{label}</span>{children}</label>;
