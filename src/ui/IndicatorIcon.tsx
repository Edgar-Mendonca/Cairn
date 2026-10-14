// Graphical indicator images for custom fields (Custom Fields › Graphical Indicators).
import type { ReactElement } from 'react';
const COLORS: Record<string, string> = {
  green: '#2e9d4f', yellow: '#f2b705', red: '#d93a3a', blue: '#2f6db1', gray: '#8c8c8c', black: '#2b2b2b', white: '#ffffff', orange: '#ef7d1a', purple: '#7b4fc2'
};

export const INDICATOR_GROUPS: [string, string[]][] = [
  ['Circles', ['circle-green', 'circle-yellow', 'circle-red', 'circle-blue', 'circle-gray', 'circle-black', 'circle-white']],
  ['Flags', ['flag-red', 'flag-green', 'flag-yellow', 'flag-blue', 'flag-purple']],
  ['Squares and diamonds', ['square-green', 'square-yellow', 'square-red', 'diamond-green', 'diamond-yellow', 'diamond-red']],
  ['Arrows', ['arrow-up-green', 'arrow-right-yellow', 'arrow-down-red', 'arrow-up-red', 'arrow-down-green']],
  ['Faces', ['face-happy', 'face-neutral', 'face-sad']],
  ['Symbols', ['check', 'cross', 'warning', 'info', 'star', 'question', 'clock', 'stop']]
];
export const ALL_INDICATORS = INDICATOR_GROUPS.flatMap(g => g[1]);

export default function IndicatorIcon({ name, size = 14 }: { name: string; size?: number }) {
  const [shape, a, b] = name.split('-');
  const col = (k?: string) => COLORS[k || ''] || COLORS.gray;
  let body: ReactElement;
  switch (shape) {
    case 'circle': body = <circle cx="8" cy="8" r="6" fill={col(a)} stroke={a === 'white' ? '#8c8c8c' : 'rgba(0,0,0,.25)'} strokeWidth="1" />; break;
    case 'square': body = <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" fill={col(a)} stroke="rgba(0,0,0,.25)" />; break;
    case 'diamond': body = <path d="M8 1.5 14.5 8 8 14.5 1.5 8z" fill={col(a)} stroke="rgba(0,0,0,.25)" />; break;
    case 'flag': body = <g><path d="M4 2v12.5" stroke="#555" strokeWidth="1.4" /><path d="M4.5 2.5h8.5l-2.2 3 2.2 3H4.5z" fill={col(a)} stroke="rgba(0,0,0,.25)" strokeWidth=".8" /></g>; break;
    case 'arrow': {
      const rot = a === 'up' ? -90 : a === 'down' ? 90 : a === 'left' ? 180 : 0;
      body = <path transform={`rotate(${rot} 8 8)`} d="M2 6h6.5V2.5L14.5 8l-6 5.5V10H2z" fill={col(b)} stroke="rgba(0,0,0,.25)" strokeWidth=".8" />;
      break;
    }
    case 'face': {
      const mouth = a === 'happy' ? 'M5 9.5q3 3 6 0' : a === 'sad' ? 'M5 11.5q3-3 6 0' : 'M5 10.5h6';
      const fill = a === 'happy' ? COLORS.green : a === 'sad' ? COLORS.red : COLORS.yellow;
      body = <g><circle cx="8" cy="8" r="6.5" fill={fill} stroke="rgba(0,0,0,.25)" /><circle cx="5.8" cy="6.3" r=".9" fill="#222" /><circle cx="10.2" cy="6.3" r=".9" fill="#222" /><path d={mouth} fill="none" stroke="#222" strokeWidth="1.1" strokeLinecap="round" /></g>;
      break;
    }
    case 'check': body = <path d="M2.5 8.5 6.5 12.5 13.5 3.5" fill="none" stroke={COLORS.green} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />; break;
    case 'cross': body = <path d="M3.5 3.5 12.5 12.5M12.5 3.5 3.5 12.5" stroke={COLORS.red} strokeWidth="2.4" strokeLinecap="round" />; break;
    case 'warning': body = <g><path d="M8 1.8 15 14H1z" fill={COLORS.yellow} stroke="#9a7400" strokeWidth=".8" /><path d="M8 6v4" stroke="#222" strokeWidth="1.5" /><circle cx="8" cy="12" r=".9" fill="#222" /></g>; break;
    case 'info': body = <g><circle cx="8" cy="8" r="6.5" fill={COLORS.blue} /><path d="M8 7v4.5" stroke="#fff" strokeWidth="1.6" /><circle cx="8" cy="4.8" r="1" fill="#fff" /></g>; break;
    case 'question': body = <g><circle cx="8" cy="8" r="6.5" fill={COLORS.purple} /><path d="M6 6.3a2 2 0 1 1 2.6 1.9c-.5.2-.6.6-.6 1.2" fill="none" stroke="#fff" strokeWidth="1.4" /><circle cx="8" cy="11.6" r=".9" fill="#fff" /></g>; break;
    case 'star': body = <path d="M8 1.5l1.9 4.1 4.5.5-3.4 3 1 4.4L8 11.3 4 13.5l1-4.4-3.4-3 4.5-.5z" fill={COLORS.yellow} stroke="#9a7400" strokeWidth=".7" />; break;
    case 'clock': body = <g><circle cx="8" cy="8" r="6.3" fill="#fff" stroke="#555" strokeWidth="1.2" /><path d="M8 4.5V8l2.5 1.5" fill="none" stroke="#555" strokeWidth="1.3" strokeLinecap="round" /></g>; break;
    case 'stop': body = <path d="M5.3 1.5h5.4l3.8 3.8v5.4l-3.8 3.8H5.3l-3.8-3.8V5.3z" fill={COLORS.red} stroke="rgba(0,0,0,.25)" />; break;
    default: body = <circle cx="8" cy="8" r="6" fill="none" stroke="#999" strokeDasharray="2 2" />;
  }
  return <svg className="ind-img" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">{body}</svg>;
}
