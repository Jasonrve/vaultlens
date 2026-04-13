interface ErrorMessageProps {
  message: string;
  onRetry?: () => void;
}

export default function ErrorMessage({ message, onRetry }: ErrorMessageProps) {
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
