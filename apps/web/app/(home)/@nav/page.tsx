import Link from 'next/link'

export default function AppPage() {
  return (
    <div className="flex flex-col">
      <div>
        <Link href="/">
          <div className="rounded-sm p-4 hover:underline">Home</div>
        </Link>
      </div>
      <div className="">
        <Link href="/app" target="_blank">
          <div className="rounded-sm p-4 hover:underline">App</div>
        </Link>
      </div>
    </div>
  )
}
