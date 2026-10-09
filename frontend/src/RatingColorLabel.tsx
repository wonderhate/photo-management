import { Star } from 'lucide-react';

const COLORS = {
  red: { bg: 'bg-red-500', hover: 'hover:bg-red-600', label: '红色' },
  yellow: { bg: 'bg-yellow-500', hover: 'hover:bg-yellow-600', label: '黄色' },
  green: { bg: 'bg-green-500', hover: 'hover:bg-green-600', label: '绿色' },
  blue: { bg: 'bg-blue-500', hover: 'hover:bg-blue-600', label: '蓝色' },
};

interface RatingStarsProps {
  rating: number | null;
  onChange?: (rating: number | null) => void;
  readonly?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export function RatingStars({ rating, onChange, readonly, size = 'md' }: RatingStarsProps) {
  const sizeClass = size === 'sm' ? 'w-3 h-3' : size === 'lg' ? 'w-6 h-6' : 'w-4 h-4';

  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(star => (
        <button
          key={star}
          type="button"
          disabled={readonly}
          onClick={() => onChange?.(rating === star ? null : star)}
          className={`${readonly ? 'cursor-default' : 'cursor-pointer hover:scale-110'} transition-transform`}
        >
          <Star
            className={`${sizeClass} ${star <= (rating || 0) ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}`}
          />
        </button>
      ))}
    </div>
  );
}

interface ColorLabelPickerProps {
  color: string | null;
  onChange?: (color: string | null) => void;
  readonly?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export function ColorLabelPicker({ color, onChange, readonly, size = 'md' }: ColorLabelPickerProps) {
  const sizeClass = size === 'sm' ? 'w-3 h-3' : size === 'lg' ? 'w-6 h-6' : 'w-4 h-4';

  return (
    <div className="flex items-center gap-1">
      {Object.entries(COLORS).map(([key, { bg, hover, label }]) => (
        <button
          key={key}
          type="button"
          disabled={readonly}
          onClick={() => onChange?.(color === key ? null : key)}
          title={label}
          className={`${sizeClass} rounded-full ${bg} ${readonly ? '' : hover} transition-all ${
            color === key ? 'ring-2 ring-offset-1 ring-gray-400 scale-110' : 'opacity-60 hover:opacity-100'
          }`}
        />
      ))}
    </div>
  );
}

interface PhotoBadgeProps {
  rating: number | null;
  colorLabel: string | null;
  className?: string;
}

export function PhotoBadge({ rating, colorLabel, className = '' }: PhotoBadgeProps) {
  if (!rating && !colorLabel) return null;

  return (
    <div className={`absolute top-1 left-1 flex flex-col gap-1 ${className}`}>
      {colorLabel && (
        <div className={`w-3 h-3 rounded-full ${COLORS[colorLabel as keyof typeof COLORS]?.bg || 'bg-gray-500'}`} />
      )}
      {rating && rating > 0 && (
        <div className="flex items-center gap-0.5 bg-black/50 rounded px-1 py-0.5">
          <Star className="w-2.5 h-2.5 fill-yellow-400 text-yellow-400" />
          <span className="text-xs text-white font-medium">{rating}</span>
        </div>
      )}
    </div>
  );
}
