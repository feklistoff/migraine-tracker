/* global document, URL, URLSearchParams, window */

const manifestLink = document.getElementById('app-manifest')
const spikeEnabled = new URLSearchParams(window.location.search).get('spike') === '1'

if (manifestLink && spikeEnabled) {
  const manifestHref = manifestLink.getAttribute('href')

  if (manifestHref) {
    const spikeManifestUrl = new URL('spike-manifest.webmanifest', new URL(manifestHref, window.location.href))
    manifestLink.setAttribute('href', `${spikeManifestUrl.pathname}${spikeManifestUrl.search}`)
  }
}
