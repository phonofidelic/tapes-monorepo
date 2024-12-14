export default function HomeLayout({
  nav,
  children,
}: Readonly<{
  nav: React.ReactNode
  children: React.ReactNode
}>) {
  return (
    <div className="flex gap-2">
      <div>{nav}</div>
      <div className="flex w-full p-4">{children}</div>
    </div>
  )
}
