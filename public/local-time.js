// Shows <time class="local-time" datetime="...Z"> in the visitor's timezone. Without script the server-rendered UTC text stays.
for (const el of document.querySelectorAll('time.local-time')) {
  const date = new Date(el.dateTime);
  if (Number.isNaN(date.getTime())) continue;
  el.title = el.textContent;
  el.textContent = date.toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });
}
