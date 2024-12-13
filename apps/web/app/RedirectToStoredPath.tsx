'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useView } from './ViewContext'

export default function RedirectToStoredPath() {
  const { currentView } = useView()
  const router = useRouter()

  useEffect(() => {
    router.replace(currentView)
  }, [])

  return null
}
