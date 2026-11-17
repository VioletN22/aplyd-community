import React, { createContext, useContext, useEffect, useState } from 'react';
import type { PrepStatus } from '../../shared/types';

type Task = PrepStatus['task'];
type PrepMap = Record<string, Partial<Record<Task, PrepStatus>>>;

interface PrepState {
  /** Latest status per application, per task. */
  byApp: PrepMap;
  /** Bumps every time a task finishes (done or error), so screens can reload. */
  finished: number;
}

const PrepContext = createContext<PrepState>({ byApp: {}, finished: 0 });

// Reached through a getter so a renderer running against an older main process
// simply sees no prep activity.
const prepApi = () => window.electronAPI?.prep;

/** Subscribes to prep:progress once, for the whole app. Mount near the root. */
export const PrepProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<PrepState>({ byApp: {}, finished: 0 });

  useEffect(() => {
    const api = prepApi();
    if (!api) return;
    const off = api.onProgress((s) => {
      setState((cur) => ({
        byApp: { ...cur.byApp, [s.applicationId]: { ...cur.byApp[s.applicationId], [s.task]: s } },
        finished: s.state === 'done' || s.state === 'error' ? cur.finished + 1 : cur.finished,
      }));
    });
    return () => { try { off && off(); } catch { /* already gone */ } };
  }, []);

  return <PrepContext.Provider value={state}>{children}</PrepContext.Provider>;
};

/** The live prep status for one application and task, if any has arrived. */
export function usePrepTask(applicationId: string | null | undefined, task: Task): PrepStatus | undefined {
  const { byApp } = useContext(PrepContext);
  return applicationId ? byApp[applicationId]?.[task] : undefined;
}

/** True while this task is running for the application. */
export function usePrepRunning(applicationId: string | null | undefined, task: Task): boolean {
  return usePrepTask(applicationId, task)?.state === 'running';
}

/** Counter that moves whenever any prep task finishes. */
export function usePrepFinished(): number {
  return useContext(PrepContext).finished;
}
