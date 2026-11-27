import { postToParent, shellOrigin } from './error-reporting'
import {
  STATIC_FILES_APP_PICK_MESSAGE,
  STATIC_FILES_APP_PICK_START_MESSAGE,
  STATIC_FILES_APP_PICK_STOP_MESSAGE,
} from './protocol'

const BLOCKED_EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'mouseup'] as const

type PickableElement = HTMLElement | SVGElement

function getPickableElement(event: Event): PickableElement | null {
  const target = event.target
  if (target instanceof SVGElement) {
    return target.ownerSVGElement ?? target
  }
  return target instanceof HTMLElement ? target : null
}

function getShallowHtml(element: Element): string {
  const clone = element.cloneNode(false) as Element
  for (const child of element.childNodes) {
    const isCollapsed = child instanceof Element && child.childElementCount > 0
    const childClone = child.cloneNode(!isCollapsed)
    if (isCollapsed) {
      childClone.textContent = '...'
    }
    clone.append(childClone)
  }
  return clone.outerHTML
}

function blockEvent(event: Event) {
  event.preventDefault()
  event.stopImmediatePropagation()
}

export function listenForElementPicking() {
  let highlighted: { element: PickableElement; outline: string; outlineOffset: string } | null = null
  function highlight(element: PickableElement | null) {
    if (highlighted) {
      highlighted.element.style.outline = highlighted.outline
      highlighted.element.style.outlineOffset = highlighted.outlineOffset
      if (highlighted.element.getAttribute('style') === '') {
        highlighted.element.removeAttribute('style')
      }
    }
    highlighted = element
      ? { element, outline: element.style.outline, outlineOffset: element.style.outlineOffset }
      : null
    if (element) {
      element.style.outline = '2px solid #146efe'
      element.style.outlineOffset = '-2px'
    }
  }

  function handleMouseOver(event: MouseEvent) {
    highlight(getPickableElement(event))
  }

  function handleClick(event: MouseEvent) {
    blockEvent(event)
    const element = getPickableElement(event)
    if (!element) {
      return
    }

    stopPicking()
    highlight(null)
    postToParent({ type: STATIC_FILES_APP_PICK_MESSAGE, html: getShallowHtml(element) })
    highlight(element)
  }

  function startPicking() {
    document.addEventListener('mouseover', handleMouseOver, true)
    document.addEventListener('click', handleClick, true)
    for (const type of BLOCKED_EVENTS) {
      document.addEventListener(type, blockEvent, true)
    }
  }

  function stopPicking() {
    document.removeEventListener('mouseover', handleMouseOver, true)
    document.removeEventListener('click', handleClick, true)
    for (const type of BLOCKED_EVENTS) {
      document.removeEventListener(type, blockEvent, true)
    }
  }

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window.parent || event.origin !== shellOrigin) {
      return
    }

    if (event.data?.type === STATIC_FILES_APP_PICK_START_MESSAGE) {
      startPicking()
      return
    }
    if (event.data?.type === STATIC_FILES_APP_PICK_STOP_MESSAGE) {
      stopPicking()
      highlight(null)
    }
  })
}
