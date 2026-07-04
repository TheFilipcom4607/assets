# Codes

A tiny offline-first PWA for generating QR codes and barcodes.

## Supported codes

- **QR Code** — plain text/URL, Wi-Fi login, phone, SMS, email presets, with selectable error correction
- **Barcodes** — Code 128, EAN-13, EAN-8, UPC-A, Code 39, ITF-14, ITF, Codabar, MSI, Pharmacode

## Install on iPhone

Open the page in Safari → tap **Share** → **Add to Home Screen**. After the first visit it works fully offline; nothing ever leaves the device.

## Tech

Static files only — no build step. Uses vendored copies of
[qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT) and
[JsBarcode](https://github.com/lindell/JsBarcode) (MIT) in `vendor/`.
`sw.js` precaches everything cache-first; icons are generated PNGs referenced from
`manifest.webmanifest`.
