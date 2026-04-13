import { ReactFlowProvider } from '@xyflow/react';
import type { ReactNode } from 'react';
import LoadingSpinner from '../common/LoadingSpinner';
import ErrorMessage from '../common/ErrorMessage';

interface GraphWrapperProps {
  loading: boolean;
  error: string | null;
  children: ReactNode;
}

export default function GraphWrapper({ loading, error, children }: GraphWrapperProps) {
  if (loading) return <LoadingSpinner className="mt-12" />;
  if (error) return <ErrorMessage message={error} />;

  return (
    <ReactFlowProvider>
      <div className="h-[600px] rounded-md border border-gray-200 bg-white">
        {children}
      </div>
    </ReactFlowProvider>
  );
}
