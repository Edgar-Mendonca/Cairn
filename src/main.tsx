import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App';
import { S } from './ui/store';
import { download } from './ui/actions';
import './ui/styles.css';

// If the interface fails, offer a copy of the plan so no work is lost.
class Guard extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <h1>Something went wrong</h1>
        <p>{this.state.error.message}</p>
        <p>Your plan is still saved in this browser. You can download a copy before reloading.</p>
        <button className="btn primary" onClick={() => download('plan-backup.cairn', JSON.stringify(S().p), 'application/json')}>Download a copy</button>
        <button className="btn" onClick={() => location.reload()}>Reload</button>
      </div>
    );
  }
}

createRoot(document.getElementById('root')!).render(<StrictMode><Guard><App /></Guard></StrictMode>);

if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
  addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => { /* offline support is optional */ }); });
}
