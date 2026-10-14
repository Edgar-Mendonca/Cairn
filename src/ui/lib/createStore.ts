// A small state container: one state object, setters that merge, and a hook that re-renders a component
// only when the slice it selects changes. It replaces an external dependency with about forty lines.
import { useCallback, useRef, useSyncExternalStore } from 'react';

type SetState<T> = (partial: Partial<T> | ((s: T) => Partial<T>), replace?: boolean) => void;
type Listener<T> = (s: T, prev: T) => void;

export interface StoreHook<T> {
  (): T;
  <U>(selector: (s: T) => U, equal?: (a: U, b: U) => boolean): U;
  getState: () => T;
  setState: SetState<T>;
  subscribe: (l: Listener<T>) => () => void;
}

export function createStore<T extends object>(init: (set: SetState<T>, get: () => T) => T): StoreHook<T> {
  let state: T;
  const listeners = new Set<Listener<T>>();
  const get = () => state;
  const set: SetState<T> = (partial, replace) => {
    const next = typeof partial === 'function' ? partial(state) : partial;
    if (next === state) return;
    const prev = state;
    state = replace ? (next as T) : Object.assign({}, state, next);
    listeners.forEach(l => l(state, prev));
  };
  const subscribe = (l: Listener<T>) => { listeners.add(l); return () => { listeners.delete(l); }; };
  state = init(set, get);

  function useStore<U>(selector?: (s: T) => U, equal: (a: U, b: U) => boolean = Object.is): U {
    const sel = selector ?? ((s: T) => s as unknown as U);
    // Keep the last selected value so a selector that builds a new object each time does not loop.
    const last = useRef<{ s: T; u: U } | null>(null);
    const read = useCallback(() => {
      const s = state, l = last.current;
      if (l && l.s === s) return l.u;
      const u = sel(s);
      if (l && equal(l.u, u)) { last.current = { s, u: l.u }; return l.u; }
      last.current = { s, u };
      return u;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selector]);
    return useSyncExternalStore(subscribe, read, read);
  }
  const hook = useStore as StoreHook<T>;
  hook.getState = get; hook.setState = set; hook.subscribe = subscribe;
  return hook;
}

// Shallow comparison for selectors that return arrays or small objects.
export function shallow<U>(a: U, b: U): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(k => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
