/**
 * Input Validation and Sanitization
 * Implements strict schema-based validation following OWASP best practices
 * 
 * Features:
 * - Type checking
 * - Length limits
 * - Format validation
 * - Reject unexpected fields
 * - Sanitize inputs
 */

import { NextResponse } from 'next/server'

// Maximum lengths for different field types
const MAX_LENGTHS = {
  projectName: 200,
  projectDescription: 2000,
  fileName: 500,
  transcription: 1000000, // 1MB of text
  content: 5000000, // 5MB of text
  filePath: 1000,
  recordingTitle: 500,
  scrapeUrl: 2048,
  uuid: 36, // UUID format
} as const

// File size limits (in bytes)
const MAX_FILE_SIZES = {
  pdf: 50 * 1024 * 1024, // 50MB
  docx: 50 * 1024 * 1024, // 50MB
  txt: 10 * 1024 * 1024, // 10MB
  audio: 500 * 1024 * 1024, // 500MB
  image: 10 * 1024 * 1024, // 10MB
} as const

/**
 * Validation error response
 */
function validationError(message: string, field?: string): NextResponse {
  return NextResponse.json(
    {
      error: 'Validation failed',
      message,
      ...(field && { field }),
    },
    { status: 400 }
  )
}

/**
 * Sanitize string input
 */
export function sanitizeString(input: unknown, maxLength: number): string {
  if (typeof input !== 'string') {
    throw new Error('Expected string')
  }
  
  // Remove null bytes and control characters (except newlines and tabs)
  let sanitized = input.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '')
  
  // Trim whitespace
  sanitized = sanitized.trim()
  
  // Enforce length limit
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength)
  }
  
  return sanitized
}

/**
 * Validate UUID format
 */
export function validateUUID(input: unknown): string {
  if (typeof input !== 'string') {
    throw new Error('Expected string for UUID')
  }
  
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(input)) {
    throw new Error('Invalid UUID format')
  }
  
  return input
}

/**
 * Validate and sanitize project ID
 */
export function validateProjectId(input: unknown): string {
  try {
    return validateUUID(input)
  } catch {
    throw new Error('Invalid project_id format')
  }
}

/**
 * Validate and sanitize recording ID
 */
export function validateRecordingId(input: unknown): string {
  try {
    return validateUUID(input)
  } catch {
    throw new Error('Invalid recording_id format')
  }
}

/**
 * Validate output type
 */
export function validateOutputType(input: unknown): 'article' | 'ad' {
  if (input !== 'article' && input !== 'ad') {
    throw new Error('output_type must be "article" or "ad"')
  }
  return input
}

/**
 * Validate file name
 */
export function validateFileName(input: unknown): string {
  const sanitized = sanitizeString(input, MAX_LENGTHS.fileName)
  
  // Check for path traversal attempts
  if (sanitized.includes('..') || sanitized.includes('/') || sanitized.includes('\\')) {
    throw new Error('Invalid file name: path traversal detected')
  }
  
  return sanitized
}

/**
 * Validate file path (for storage)
 */
export function validateFilePath(input: unknown): string {
  const sanitized = sanitizeString(input, MAX_LENGTHS.filePath)
  
  // Basic path validation (should be relative path without ..)
  if (sanitized.startsWith('/') || sanitized.includes('..')) {
    throw new Error('Invalid file path: must be relative path without traversal')
  }
  
  return sanitized
}

/**
 * Validate transcription text
 */
export function validateTranscription(input: unknown): string {
  return sanitizeString(input, MAX_LENGTHS.transcription)
}

/**
 * Validate project name
 */
export function validateProjectName(input: unknown): string {
  const sanitized = sanitizeString(input, MAX_LENGTHS.projectName)
  
  if (sanitized.length === 0) {
    throw new Error('Project name cannot be empty')
  }
  
  return sanitized
}

/**
 * Validate project description
 */
export function validateProjectDescription(input: unknown): string | undefined {
  if (input === undefined || input === null) {
    return undefined
  }
  
  return sanitizeString(input, MAX_LENGTHS.projectDescription)
}

/**
 * Validate recording title
 */
export function validateRecordingTitle(input: unknown): string {
  return sanitizeString(input, MAX_LENGTHS.recordingTitle)
}

/**
 * Validate audio URL
 */
export function validateAudioUrl(input: unknown): string {
  if (typeof input !== 'string') {
    throw new Error('audioUrl must be a string')
  }
  
  // Basic URL validation
  try {
    const url = new URL(input)
    // Only allow https URLs
    if (url.protocol !== 'https:') {
      throw new Error('Only HTTPS URLs are allowed')
    }
    // Check for suspicious patterns
    if (url.hostname.includes('localhost') || url.hostname.includes('127.0.0.1')) {
      // Allow localhost only in development
      if (process.env.NODE_ENV === 'production') {
        throw new Error('Localhost URLs not allowed in production')
      }
    }
    return input
  } catch (error: any) {
    if (error.message.includes('Invalid URL')) {
      throw new Error('Invalid audioUrl format')
    }
    throw error
  }
}

/**
 * Validate URL for web scraping (http or https, optional localhost block in production)
 */
export function validateScrapeUrl(input: unknown): string {
  const raw = typeof input === 'string' ? input.trim() : ''
  if (!raw) {
    throw new Error('URL is required')
  }
  const url = sanitizeString(raw, MAX_LENGTHS.scrapeUrl)
  if (url.length === 0) {
    throw new Error('URL is required')
  }
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('URL must use http or https')
    }
    if (parsed.hostname.includes('localhost') || parsed.hostname.includes('127.0.0.1')) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('Localhost URLs not allowed in production')
      }
    }
    return url
  } catch (error: any) {
    if (error.message?.includes('Invalid URL')) {
      throw new Error('Invalid URL format')
    }
    throw error
  }
}

/**
 * Validate file size
 */
export function validateFileSize(size: number, type: keyof typeof MAX_FILE_SIZES): void {
  const maxSize = MAX_FILE_SIZES[type]
  if (size > maxSize) {
    throw new Error(`File size exceeds maximum of ${Math.round(maxSize / 1024 / 1024)}MB for ${type} files`)
  }
  
  if (size <= 0) {
    throw new Error('File size must be greater than 0')
  }
}

/**
 * Validate file type
 */
export function validateFileType(
  fileName: string,
  allowedTypes: string[]
): { extension: string; type: string } {
  const lowerName = fileName.toLowerCase()
  const extension = lowerName.split('.').pop()
  
  if (!extension) {
    throw new Error('File must have an extension')
  }
  
  if (!allowedTypes.includes(extension)) {
    throw new Error(`Unsupported file type. Allowed: ${allowedTypes.join(', ')}`)
  }
  
  return { extension, type: extension }
}

/**
 * Validate request body schema - only allow expected fields
 */
export function validateSchema<T extends Record<string, any>>(
  body: unknown,
  schema: {
    [K in keyof T]: {
      required?: boolean
      type: 'string' | 'number' | 'boolean' | 'object' | 'array'
      validator?: (value: unknown) => T[K]
      sanitizer?: (value: unknown) => T[K]
    }
  }
): T {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('Request body must be an object')
  }
  
  const result = {} as T
  const bodyObj = body as Record<string, unknown>
  
  // Check for unexpected fields
  const allowedKeys = Object.keys(schema)
  const receivedKeys = Object.keys(bodyObj)
  const unexpectedKeys = receivedKeys.filter(key => !allowedKeys.includes(key))
  
  if (unexpectedKeys.length > 0) {
    throw new Error(`Unexpected fields: ${unexpectedKeys.join(', ')}`)
  }
  
  // Validate and sanitize each field
  for (const [key, config] of Object.entries(schema)) {
    const value = bodyObj[key]
    
    if (value === undefined || value === null) {
      if (config.required) {
        throw new Error(`${key} is required`)
      }
      continue
    }
    
    // Type check
    if (config.type === 'string' && typeof value !== 'string') {
      throw new Error(`${key} must be a string`)
    } else if (config.type === 'number' && typeof value !== 'number') {
      throw new Error(`${key} must be a number`)
    } else if (config.type === 'boolean' && typeof value !== 'boolean') {
      throw new Error(`${key} must be a boolean`)
    } else if (config.type === 'object' && (typeof value !== 'object' || Array.isArray(value))) {
      throw new Error(`${key} must be an object`)
    } else if (config.type === 'array' && !Array.isArray(value)) {
      throw new Error(`${key} must be an array`)
    }
    
    // Apply validator or sanitizer
    if (config.validator) {
      result[key as keyof T] = config.validator(value) as T[keyof T]
    } else if (config.sanitizer) {
      result[key as keyof T] = config.sanitizer(value) as T[keyof T]
    } else {
      result[key as keyof T] = value as T[keyof T]
    }
  }
  
  return result
}

/**
 * Safe JSON parse with validation
 */
export function safeJsonParse<T>(input: string, validator?: (parsed: unknown) => T): T {
  try {
    const parsed = JSON.parse(input)
    if (validator) {
      return validator(parsed)
    }
    return parsed as T
  } catch (error) {
    throw new Error('Invalid JSON format')
  }
}
