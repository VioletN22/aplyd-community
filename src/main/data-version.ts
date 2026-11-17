/** SQLite data_version changes only for writes made by another connection. */
export function watchDataVersion(read: () => number, changed: () => void): () => void {
  let previous = read();
  const timer = setInterval(() => {
    try { const next=read(); if(next!==previous){previous=next;changed();} }
    catch { /* App shutdown can close the DB before the timer is disposed. */ }
  },3000);
  timer.unref?.();
  return ()=>clearInterval(timer);
}
