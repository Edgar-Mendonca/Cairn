import { useEffect, useRef, useState } from "react";
// Colour swatches for font colour, cell background and bar colour.
export const PALETTE = [
  '#000000', '#404040', '#7f7f7f', '#bfbfbf', '#ffffff',
  '#c00000', '#e06666', '#f4cccc', '#ff0000', '#ffc7ce',
  '#ed7d31', '#f6b26b', '#fce5cd', '#ffc000', '#fff2cc',
  '#548235', '#70ad47', '#d9ead3', '#00b050', '#c6efce',
  '#1f4e79', '#2f6db1', '#9fc5e8', '#00b0f0', '#ddebf7',
  '#7030a0', '#8e7cc3', '#d9d2e9', '#0a4c96', '#ffeb9c'
];

export default function Palette({ value, onPick, auto = 'Automatic' }: { value?: string; onPick: (c: string | undefined) => void; auto?: string }) {
  return (
    <div className="palette" onMouseDown={e => e.preventDefault()}>
      <button type="button" className="pal-auto" onClick={() => onPick(undefined)}>{auto}</button>
      <div className="pal-grid">
        {PALETTE.map(c => <button type="button" key={c} className={'pal-sw' + (value === c ? ' on' : '')} style={{ background: c }} title={c} aria-label={c} onClick={() => onPick(c)} />)}
      </div>
      <label className="pal-custom">More colours <input type="color" value={value || '#000000'} onChange={e => onPick(e.target.value)} /></label>
    </div>
  );
}

// A compact colour field for dialogs: a swatch button that opens the palette in a pop-up.
export function ColorField({ value, onPick, auto = 'Automatic' }: { value?: string; onPick: (c: string | undefined) => void; auto?: string }) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!pos) return;
    const close = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.color-pop') && e.target !== ref.current) setPos(null); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [pos]);
  const open = () => { const r = ref.current!.getBoundingClientRect(); setPos({ left: Math.min(r.left, innerWidth - 200), top: r.bottom + 220 > innerHeight ? r.top - 218 : r.bottom + 2 }); };
  return (
    <>
      <button type="button" ref={ref} className="color-field" onClick={() => (pos ? setPos(null) : open())}>
        <i style={{ background: value || 'transparent' }} className={value ? '' : 'none'} /><span>{value ? value.toUpperCase() : auto}</span><em>▾</em>
      </button>
      {pos && <div className="popup color-pop" style={pos}><Palette value={value} onPick={c => { onPick(c); setPos(null); }} auto={auto} /></div>}
    </>
  );
}
