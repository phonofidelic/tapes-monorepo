import { AudioInputSelector } from '../AudioInputSelector'

export default function SettingsPage() {
  return (
    <div className="flex h-full flex-col p-5 pb-20">
      <label className="flex flex-col gap-4">
        <h3>Audio input</h3>
        <AudioInputSelector />
      </label>
    </div>
  )
}
