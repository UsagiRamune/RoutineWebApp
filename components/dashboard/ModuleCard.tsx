import Link from 'next/link'
import { ReactNode } from 'react'

interface Props {
  href: string
  title: string
  children: ReactNode
}

export default function ModuleCard({ href, title, children }: Props) {
  return (
    <Link href={href}
      className="block bg-[#1B1F2A] border border-[#2A2F3D] rounded-xl p-4
        hover:border-[#7C8394] transition-colors">
      <p className="text-sm font-medium mb-2">{title}</p>
      {children}
    </Link>
  )
}
