'use client'

import type { ReactNode } from 'react'

const labelClass = 'text-caption text-medium-gray uppercase tracking-wider'
const inputBaseClass =
  'w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-md transition-colors focus:outline-none'
const inputEditableClass = 'focus:border-cosmic-orange cursor-text'
const inputReadOnlyClass = 'cursor-default opacity-75'
const textareaBaseClass =
  'w-full px-4 py-3 bg-white/5 border border-white/10 rounded-glass text-secondary-white text-body-sm transition-colors resize-none focus:outline-none'
const textareaEditableClass = 'focus:border-cosmic-orange cursor-text'
const textareaReadOnlyClass = 'cursor-default opacity-75'

export interface ModalFieldLabelProps {
  label: string
  /** Optional action (e.g. copy button) on the right */
  action?: ReactNode
}

export function ModalFieldLabel({ label, action }: ModalFieldLabelProps) {
  return (
    <div className="flex items-center justify-between mb-2">
      <label className={labelClass}>{label}</label>
      {action}
    </div>
  )
}

export interface ModalFieldInputProps {
  label: string
  action?: ReactNode
  value: string
  onChange?: (value: string) => void
  readOnly?: boolean
  placeholder?: string
  id?: string
  /** Extra input class */
  className?: string
}

export function ModalFieldInput({
  label,
  action,
  value,
  onChange,
  readOnly = false,
  placeholder,
  id,
  className = '',
}: ModalFieldInputProps) {
  const editable = !readOnly && onChange
  return (
    <div>
      <ModalFieldLabel label={label} action={action} />
      <input
        id={id}
        type="text"
        value={value}
        onChange={editable ? (e) => onChange(e.target.value) : undefined}
        readOnly={readOnly}
        placeholder={placeholder}
        className={`${inputBaseClass} ${editable ? inputEditableClass : inputReadOnlyClass} ${className}`}
      />
    </div>
  )
}

export interface ModalFieldTextareaProps {
  label: string
  action?: ReactNode
  value: string
  onChange?: (value: string) => void
  readOnly?: boolean
  placeholder?: string
  rows?: number
  /** If set, this container gets max height and overflow-y-auto so only this field scrolls */
  scrollable?: boolean
  id?: string
  className?: string
}

export function ModalFieldTextarea({
  label,
  action,
  value,
  onChange,
  readOnly = false,
  placeholder,
  rows = 4,
  scrollable = false,
  id,
  className = '',
}: ModalFieldTextareaProps) {
  const editable = !readOnly && onChange
  return (
    <div>
      <ModalFieldLabel label={label} action={action} />
      <textarea
        id={id}
        value={value}
        onChange={editable ? (e) => onChange(e.target.value) : undefined}
        readOnly={readOnly}
        placeholder={placeholder}
        rows={rows}
        className={`${textareaBaseClass} ${editable ? textareaEditableClass : textareaReadOnlyClass} ${scrollable ? 'max-h-[40vh] overflow-y-auto custom-scrollbar' : ''} ${className}`}
      />
    </div>
  )
}

/** Standard field container class for consistent spacing (e.g. space-y-5 between fields) */
export const modalFieldSpacing = 'space-y-5'
