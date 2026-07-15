import { useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'

export default function DownloadPrompt() {
  const [url] = useState(() => window.location.href)

  return (
    <>
      <div>
        <p>
          Download the app on{' '}
          <a className="hover:underline" href="#">
            macOS
          </a>
          ,
        </p>
        <p> or open this page on your mobile device:</p>
      </div>
      {url ? (
        <QRCodeSVG value={url} fgColor="#18181b" />
      ) : (
        <div className="size-[128px]" />
      )}
    </>
  )
}
