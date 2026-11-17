// Escape closes the topmost confirm dialog. The listener runs in the capture
// phase and stops the key there, so a modal underneath the dialog does not
// also close on the same key press.

export function attachEscape(target: EventTarget, onEscape: () => void): () => void {
  const listener = (event: Event) => {
    if ((event as KeyboardEvent).key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onEscape();
  };
  target.addEventListener('keydown', listener, { capture: true });
  return () => target.removeEventListener('keydown', listener, { capture: true });
}
