import { useEffect, useRef, useState } from 'react'
import { getAudioStream } from '@/utils'

export function AudioVisualizer({
  audioInputDeviceId,
  feature,
  containerRef,
}: {
  audioInputDeviceId: string
  feature: 'frequency' | 'time-domain'
  containerRef: React.RefObject<HTMLDivElement | null>
}) {
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light',
  )
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

    const onThemeChange = (event: MediaQueryListEvent) => {
      setTheme(event.matches ? 'dark' : 'light')
    }

    mediaQuery.addEventListener('change', onThemeChange)

    return () => {
      mediaQuery.removeEventListener('change', onThemeChange)
    }
  }, [])

  useEffect(() => {
    const onResize = () => {
      if (!containerRef.current) {
        return
      }

      const containerRect = containerRef.current.getBoundingClientRect()
      setCanvasSize({
        width: containerRect.width,
        height: containerRect.height,
      })
    }

    onResize()
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
    }
  }, [])

  useEffect(() => {
    if (!canvasRef.current) {
      return
    }

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')

    if (!ctx) {
      return
    }

    const audioContext = new AudioContext()
    let rafId: number
    let stream: MediaStream | undefined
    let cancelled = false

    getAudioStream(audioInputDeviceId)
      .then((mediaStream) => {
        // getAudioStream is async; the effect may have been torn down (device
        // change, unmount) before it resolved. Don't start a second graph.
        if (cancelled) {
          mediaStream.getTracks().forEach((track) => track.stop())
          return
        }
        stream = mediaStream
        const source = audioContext.createMediaStreamSource(stream)
        const analyser = audioContext.createAnalyser()
        analyser.fftSize = 128
        source.connect(analyser)

        const dataArray = new Uint8Array(analyser.frequencyBinCount)

        const tick = () => {
          if (feature === 'frequency') {
            analyser.getByteFrequencyData(dataArray)
          } else {
            analyser.getByteTimeDomainData(dataArray)
          }

          draw({
            dataArray,
            feature,
            theme,
            ctx,
            canvasWidth: canvas.width,
            canvasHeight: canvas.height,
          })

          rafId = requestAnimationFrame(tick)
        }

        tick()
      })
      .catch((err) => {
        console.error('Could not process audio stream:', err)
      })

    return () => {
      cancelled = true
      cancelAnimationFrame(rafId)
      stream?.getTracks().forEach((track) => track.stop())
      audioContext.close().catch(() => {})
    }
  }, [audioInputDeviceId, feature, theme])

  return (
    <canvas
      ref={canvasRef}
      width={canvasSize.width}
      height={canvasSize.height}
      style={{
        transform: 'rotateX(180deg)',
      }}
    />
  )
}

const draw = ({
  dataArray,
  feature,
  theme,
  ctx,
  canvasWidth,
  canvasHeight,
}: {
  dataArray: Uint8Array | []
  feature: 'frequency' | 'time-domain'
  theme: 'dark' | 'light'
  ctx: CanvasRenderingContext2D
  canvasWidth: number
  canvasHeight: number
}) => {
  let x = 0
  const sliceWidth = (canvasWidth * 1.0) / dataArray.length
  ctx.lineWidth = 1

  ctx.clearRect(0, 0, canvasWidth, canvasHeight)

  const drawAverage = () => {
    // Draw average
    const sum = (dataArray as any[]).reduce((a: number, b: number) => a + b)
    const average = sum / dataArray.length || 0
    ctx.strokeStyle = theme === 'dark' ? '#a1a1aa' : '#a1a1aa'
    if (average >= 128) {
      ctx.strokeStyle = '#f43f5e'
      ctx.lineWidth = 3
    }
    const aveY = (average / 255.0) * canvasHeight
    ctx.globalAlpha = average / 100
    ctx.beginPath()
    ctx.moveTo(0, aveY)
    ctx.lineTo(canvasWidth, aveY)
    ctx.stroke()
  }
  if (feature === 'frequency') {
    drawAverage()
  }

  // Draw curve
  ctx.globalAlpha = 1
  ctx.lineWidth = 1
  ctx.strokeStyle = theme === 'dark' ? '#a1a1aa' : '#a1a1aa'
  ctx.fillStyle = theme === 'dark' ? '#a1a1aa' : '#a1a1aa'
  ctx.beginPath()
  for (const item of dataArray) {
    // Normalize point data to canvas dimensions
    const y = (item / 255.0) * canvasHeight
    ctx.lineTo(x, y)
    x += sliceWidth
  }
  if (feature === 'frequency') {
    ctx.lineTo(x, 0)
  } else {
    ctx.lineTo(x, canvasHeight / 2)
  }
  ctx.stroke()
}
