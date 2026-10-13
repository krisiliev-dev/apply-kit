// The only code that runs inside the page Kris is viewing, and only when Kris clicks Capture: it reads
// the page as Chrome has rendered it and returns it. It never scrolls, clicks, opens, follows a link
// or waits for more to load; listings the site hasn't rendered stay unread (the service counts them).
// Chrome serialises this function into the tab (scripting.executeScript), so it must not use anything
// from outside its own body.
export function grabPage(): { url: string; html: string; frames: { id: string | null; html: string }[] } {
  const strip = (root: Element) => {
    // Scripts other than JSON-LD, styles and images aren't needed to read jobs.
    for (const el of Array.from(root.querySelectorAll('script:not([type="application/ld+json"]), style, noscript, svg, img, video, canvas'))) el.remove();
    return root.outerHTML;
  };
  const frames: { id: string | null; html: string }[] = [];
  for (const frame of Array.from(document.querySelectorAll("iframe"))) {
    try {
      // Same-origin frames only (jobs.bg keeps a job's description in one); others can't be read.
      const doc = frame.contentDocument;
      if (doc?.documentElement) frames.push({ id: frame.id || null, html: strip(doc.documentElement.cloneNode(true) as Element) });
    } catch {
      // A cross-origin frame: left alone.
    }
  }
  return { url: location.href, html: strip(document.documentElement.cloneNode(true) as Element), frames };
}
