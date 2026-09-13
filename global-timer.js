(() => {
  const POSITION_KEY = 'larboard-global-timer-top';
  const timer = document.createElement('aside');
  timer.className = 'global-timer';
  timer.setAttribute('aria-label', 'Global 15 minute counter');
  timer.innerHTML = '<span class="global-timer__digits" aria-live="polite">15:00</span>';
  const style = document.createElement('style');
  style.textContent = '.global-timer{position:fixed;z-index:2147483647;left:0;display:grid;place-items:center;width:58px;height:32px;border:1px solid #2b5964;border-left:0;border-radius:0 8px 8px 0;color:#b8fff2;background:#071a29;box-shadow:0 4px 16px rgb(0 0 0 / 22%);font:700 13px/1 ui-monospace,SFMono-Regular,Menlo,monospace;cursor:grab;touch-action:none;user-select:none}.global-timer.is-dragging{cursor:grabbing;background:#0b2b3a}.global-timer__digits{letter-spacing:.04em}';
  document.head.append(style);
  document.body.append(timer);

  const digits = timer.querySelector('.global-timer__digits');
  let endsAt = 0;
  let serverOffset = 0;
  let dragOffset = 0;
  let dragging = false;
  const savedTop = Number.parseFloat(localStorage.getItem(POSITION_KEY));
  const setTop = (top) => {
    const maxTop = Math.max(0, window.innerHeight - timer.offsetHeight);
    timer.style.top = `${Math.max(0, Math.min(maxTop, top))}px`;
  };
  const formatTime = (remainingMs) => {
    const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
    return `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
  };
  const render = () => {
    digits.textContent = formatTime(endsAt - (Date.now() + serverOffset));
  };
  const sync = async () => {
    try {
      const response = await fetch('/api/timer', { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      endsAt = Number(data.endsAt);
      serverOffset = Number(data.serverNow) - Date.now();
      render();
    } catch { /* Keep the last server value during a transient outage. */ }
  };
  timer.addEventListener('pointerdown', (event) => {
    dragging = true;
    dragOffset = event.clientY - timer.getBoundingClientRect().top;
    timer.setPointerCapture(event.pointerId);
    timer.classList.add('is-dragging');
  });
  timer.addEventListener('pointermove', (event) => {
    if (dragging) setTop(event.clientY - dragOffset);
  });
  const stopDragging = (event) => {
    if (!dragging) return;
    dragging = false;
    timer.classList.remove('is-dragging');
    localStorage.setItem(POSITION_KEY, timer.style.top);
    if (event.pointerId !== undefined && timer.hasPointerCapture(event.pointerId)) timer.releasePointerCapture(event.pointerId);
  };
  timer.addEventListener('pointerup', stopDragging);
  timer.addEventListener('pointercancel', stopDragging);
  window.addEventListener('resize', () => setTop(Number.parseFloat(timer.style.top) || 0));
  requestAnimationFrame(() => setTop(Number.isFinite(savedTop) ? savedTop : (window.innerHeight - timer.offsetHeight) / 2));
  sync();
  render();
  setInterval(render, 250);
  setInterval(sync, 1000);
})();
