const identityKeys = ['action', 'index', 'value', 'option', 'uid', 'seat'];
const usable = element => !!element?.isConnected && !element.disabled
  && !element.closest('[inert],[hidden]') && element.getClientRects().length > 0;

/** Call only after the closing dialog's background is no longer inert. */
export function restoreModalOpener(opener, controls = [], fallback = null) {
  if (!opener) return null;
  const replacement = opener.action ? controls.find(element => identityKeys.every(key => element.dataset[key] === opener[key])) : null;
  for (const element of [opener.element, replacement, fallback]) {
    if (!usable(element)) continue;
    element.focus({ preventScroll: true });
    if (element.ownerDocument.activeElement === element) return element;
  }
  return null;
}
