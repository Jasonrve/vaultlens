const colorMap: Record<string, string> = {
  read: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  write: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
  list: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200',
  delete: 'bg-red-50 text-red-600 ring-1 ring-red-200',
  create: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  sudo: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200',
  deny: 'bg-gray-100 text-gray-500 ring-1 ring-gray-200',
  kv: 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200',
  ssh: 'bg-teal-50 text-teal-700 ring-1 ring-teal-200',
  transit: 'bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200',
  pki: 'bg-pink-50 text-pink-700 ring-1 ring-pink-200',
  default: 'bg-gray-100 text-gray-600 ring-1 ring-gray-200',
};

interface BadgeProps {
  text: string;
  variant?: string;
  className?: string;
}

export default function Badge({ text, variant, className = '' }: BadgeProps) {
  const key = variant ?? text.toLowerCase();
  const colors = colorMap[key] ?? colorMap.default;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors} ${className}`}
    >
      {text}
    </span>
  );
}

