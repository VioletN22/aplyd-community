import React, { useCallback, useEffect, useRef, useState } from 'react';

export interface ToastState { message: string; show: (message: string) => void }

/** A short-lived confirmation line: what just happened, in the interface's words. */
export function useToast(): ToastState {
  const [message, setMessage] = useState('');
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((m: string) => {
    setMessage(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(''), 3600);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return { message, show };
}

export const Toast: React.FC<{ state: ToastState }> = ({ state }) =>
  state.message ? <div className="toast" role="status">{state.message}</div> : null;
