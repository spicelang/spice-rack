// Closes green notices: <button data-dismiss="notice"> removes its alert. The buttons are hidden until this script runs.
for (const button of document.querySelectorAll('[data-dismiss="notice"]')) {
  button.hidden = false;
  button.addEventListener('click', () => button.closest('.notice')?.remove());
}
