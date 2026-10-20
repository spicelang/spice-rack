// Adds a copy button to the top right of every code block in rendered markdown (READMEs, changelogs). Without script, or
// where the Clipboard API is unavailable (plain http), the code blocks stay as they are.
const svg = (paths) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
const copyIcon = svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>');
const doneIcon = svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>');

if (navigator.clipboard) {
  for (const pre of document.querySelectorAll('.markdown-body pre')) {
    // The wrapper keeps the button in place while the code scrolls horizontally
    const wrapper = document.createElement('div');
    wrapper.className = 'code-block';
    pre.replaceWith(wrapper);
    wrapper.append(pre);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'copy-code';
    const show = (copied) => {
      button.innerHTML = copied ? doneIcon : copyIcon;
      button.title = copied ? 'Copied' : 'Copy code';
      button.setAttribute('aria-label', button.title);
      button.classList.toggle('copied', copied);
    };
    show(false);
    let timer;
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(pre.textContent.replace(/\n$/, ''));
      } catch {
        return; // permission denied: nothing was copied
      }
      show(true);
      clearTimeout(timer);
      timer = setTimeout(() => show(false), 2000);
    });
    wrapper.append(button);
  }
}
