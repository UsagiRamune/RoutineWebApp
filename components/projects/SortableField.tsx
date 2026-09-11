'use client'

// ห่อ field หนึ่งอันให้ลากจัดลำดับได้ (dnd-kit) — เปิด handle (⠿) ให้ caller render เองผ่าน render-prop
// เพื่อไม่ต้องรื้อ JSX เดิมของ field ทั้งก้อนออกมาเป็นไฟล์แยก (เกาะ attributes/listeners แค่ที่ handle เท่านั้น
// ตัวการ์ดทั้งใบไม่ลาก กันปุ่ม/input ข้างในโดนแย่ง event ไปเป็นการลาก)
import { ReactNode } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { DraggableAttributes } from '@dnd-kit/core'
import type { SyntheticListenerMap } from '@dnd-kit/core/dist/hooks/utilities'

export interface DragHandleProps {
  attributes: DraggableAttributes
  listeners: SyntheticListenerMap | undefined
  setActivatorNodeRef: (el: HTMLElement | null) => void
  isDragging: boolean
}

interface Props {
  id: string
  children: (handle: DragHandleProps) => ReactNode
}

export default function SortableField({ id, children }: Props) {
  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging,
  } = useSortable({ id })

  // CSS.Translate (ไม่ใช่ CSS.Transform) ตัด scaleX/scaleY ที่ dnd-kit คำนวณจากขนาด item ข้างเคียงตอน
  // reflow ออกไปเลย — ปล่อยให้ Transform เต็มๆ ทำให้การ์ดที่สูง/เตี้ยไม่เท่ากันบิดเบี้ยวตอนลาก
  // (บั๊กที่รู้จักกันดีของ dnd-kit เอง เอกสาร/GitHub issue แนะนำให้ใช้ Translate แทนเสมอสำหรับ sortable list)
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  }

  return (
    <div ref={setNodeRef} style={style}
      className={`relative ${isDragging ? 'opacity-90 scale-[1.02] shadow-xl z-10' : ''}`}>
      {children({ attributes, listeners, setActivatorNodeRef, isDragging })}
    </div>
  )
}
