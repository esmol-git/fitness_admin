type FormTabNavigationOptions = {
  skipWithinSelectors?: string[]
  loop?: boolean
}

const defaultSkipSelectors = [
  '.va-input-wrapper__append-inner',
  '.va-input-wrapper__prepend-inner',
]

function isFocusableWithinForm(el: HTMLElement, skipWithinSelectors: string[]) {
  if (el.hasAttribute('disabled')) return false
  if (el.getAttribute('aria-disabled') === 'true') return false
  if (el.getAttribute('tabindex') === '-1') return false
  if (skipWithinSelectors.some((selector) => el.closest(selector))) return false
  return el.offsetParent !== null || el.getClientRects().length > 0
}

function getFormTabStops(root: HTMLElement, skipWithinSelectors: string[]) {
  const candidates = root.querySelectorAll<HTMLElement>(
    'input:not([type="hidden"]), select, textarea, button, [tabindex]:not([tabindex="-1"])',
  )
  return Array.from(candidates).filter((el) => isFocusableWithinForm(el, skipWithinSelectors))
}

export function useFormTabNavigation(options: FormTabNavigationOptions = {}) {
  const skipWithinSelectors = options.skipWithinSelectors ?? defaultSkipSelectors
  const loop = options.loop ?? true

  function onFormTabKeydown(event: KeyboardEvent) {
    if (event.key !== 'Tab') return
    const root = event.currentTarget
    if (!(root instanceof HTMLElement)) return
    const stops = getFormTabStops(root, skipWithinSelectors)
    if (stops.length < 2) return
    const active = document.activeElement
    if (!(active instanceof HTMLElement)) return
    const index = stops.indexOf(active)
    if (index < 0) return
    const isFirst = index === 0
    const isLast = index === stops.length - 1
    if (!loop && ((event.shiftKey && isFirst) || (!event.shiftKey && isLast))) {
      // Allow browser-native focus escape from the container.
      return
    }
    event.preventDefault()
    const nextIndex = event.shiftKey
      ? (index - 1 + stops.length) % stops.length
      : (index + 1) % stops.length
    stops[nextIndex]?.focus()
  }

  return { onFormTabKeydown }
}
