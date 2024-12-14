'use client'

import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import Link from 'next/link'

export default function DownloadPrompt() {
  const [url, setUrl] = useState('')

  useEffect(() => {
    setUrl(window.location.href)
  }, [])

  return (
    <>
      <div>
        <p>
          Download the app on{' '}
          <Link className="hover:underline" href="#">
            macOS
          </Link>
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
