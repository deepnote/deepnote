import { domToBlob } from 'modern-screenshot'
import { STATIC_FILES_APP_PREVIEW_REQUEST_MESSAGE, STATIC_FILES_APP_PREVIEW_WIDTH } from './protocol'

const PREVIEW_ASPECT_RATIO = 16 / 10

function getPageBackgroundColor() {
  for (const element of [document.body, document.documentElement]) {
    const color = getComputedStyle(element).backgroundColor
    if (color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') {
      return color
    }
  }
  return '#ffffff'
}

async function capturePreview() {
  if (document.readyState !== 'complete') {
    await new Promise(resolve => window.addEventListener('load', resolve, { once: true }))
  }
  await document.fonts.ready

  const width = window.innerWidth
  return domToBlob(document.body, {
    width,
    height: Math.round(width / PREVIEW_ASPECT_RATIO),
    scale: STATIC_FILES_APP_PREVIEW_WIDTH / width,
    type: 'image/png',
    backgroundColor: getPageBackgroundColor(),
  })
}

export function answerPreviewRequests() {
  if (window.parent === window) {
    return
  }

  window.addEventListener('message', async event => {
    if (event.source !== window.parent || event.data?.type !== STATIC_FILES_APP_PREVIEW_REQUEST_MESSAGE) {
      return
    }

    const replyPort = event.ports[0]
    if (!replyPort) {
      return
    }

    const image = await capturePreview().catch(error => {
      // biome-ignore lint/suspicious/noConsole: the page owner's only signal that preview capture failed
      console.warn('Deepnote could not capture the app preview.', error)
      return null
    })
    replyPort.postMessage(image)
    replyPort.close()
  })
}
