export default function ForbiddenMessage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 py-24 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
        <svg
          className="h-8 w-8 text-gray-400"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
          />
        </svg>
      </div>
      <div>
        <p className="text-base font-semibold text-gray-700">Access denied</p>
        <p className="mt-1 text-sm text-gray-400">
          You don&apos;t have permission to view this resource.
        </p>
      </div>
    </div>
  );
}
