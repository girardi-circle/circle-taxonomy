import { cn } from '@/lib/utils'

const NATURE_COLORS = {
  bug: 'bg-orange-100 text-orange-700 border-orange-200',
  question: 'bg-blue-100 text-blue-700 border-blue-200',
  feature_request: 'bg-purple-100 text-purple-700 border-purple-200',
  complaint: 'bg-pink-100 text-pink-700 border-pink-200',
  feedback: 'bg-teal-100 text-teal-700 border-teal-200',
  exploration: 'bg-gray-100 text-gray-700 border-gray-200',
  cancellation: 'bg-red-100 text-red-700 border-red-200',
}

const INTENT_COLORS = {
  support: 'bg-blue-100 text-blue-700 border-blue-200',
  action: 'bg-green-100 text-green-700 border-green-200',
  insights: 'bg-purple-100 text-purple-700 border-purple-200',
  strategy: 'bg-amber-100 text-amber-700 border-amber-200',
  sales: 'bg-teal-100 text-teal-700 border-teal-200',
}

const SENTIMENT_COLORS = {
  positive: 'bg-green-100 text-green-700 border-green-200',
  negative: 'bg-red-100 text-red-700 border-red-200',
  neutral: 'bg-gray-100 text-gray-600 border-gray-200',
  frustrated: 'bg-orange-100 text-orange-700 border-orange-200',
}

const STATUS_COLORS = {
  pending: 'bg-gray-100 text-gray-600 border-gray-200',
  matched: 'bg-green-100 text-green-700 border-green-200',
  unmatched: 'bg-orange-100 text-orange-700 border-orange-200',
  under_review: 'bg-blue-100 text-blue-700 border-blue-200',
}

function badge(value, colorMap) {
  const key = value?.toLowerCase().replace(' ', '_')
  const colors = colorMap[key] || 'bg-gray-100 text-gray-600 border-gray-200'
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        colors
      )}
    >
      {value}
    </span>
  )
}

export function NatureBadge({ value }) {
  return badge(value, NATURE_COLORS)
}

export function IntentBadge({ value }) {
  return badge(value, INTENT_COLORS)
}

export function SentimentBadge({ value }) {
  return badge(value, SENTIMENT_COLORS)
}

export function StatusBadge({ value }) {
  return badge(value?.replace('_', ' '), STATUS_COLORS)
}
