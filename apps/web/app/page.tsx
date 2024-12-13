import { redirect } from 'next/navigation'
import RedirectToStoredPath from './RedirectToStoredPath'

export default function Home() {
  // redirect('/recorder')
  return <RedirectToStoredPath />
}
