import ForbiddenMessage from './ForbiddenMessage';

interface ErrorMessageProps {
  message: string;
  onRetry?: () => void;
}

function isForbidden(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    message.includes('403') ||
    lower.includes('forbidden') ||
    lower.includes('permission denied')
  );
}

export default function ErrorMessage({ message, onRetry }: ErrorMessageProps) {
  if (isForbidden(message)) {
    return <ForbiddenMessage />;
  }

  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-4">
      <div className="flex items-center gap-2">
        <span className="text-red-600">⚠</span>
        <p className="text-sm text-red-700">{message}</p>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-2 text-sm font-medium text-red-600 hover:text-red-800"
        >
          Try again
        </button>
      )}
    </div>
  );
}
