'use client'

interface Props {
  checked: boolean
  onChange: () => void
  disabled?: boolean
}

export default function Toggle({ checked, onChange, disabled }: Props) {
  return (
    <button type="button" onClick={onChange} disabled={disabled}
      className={`relative inline-block w-11 h-6 rounded-full flex-shrink-0
        transition-colors disabled:opacity-50
        ${checked ? 'bg-[#4FC1E0]' : 'bg-[#2A2F3D]'}`}>
      <span className={`absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-[#EDEAE0]
        transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  )
}
