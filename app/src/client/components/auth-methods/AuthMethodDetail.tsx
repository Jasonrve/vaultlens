import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import * as api from '../../lib/api';
import type { AuthMethod } from '../../types';
import LoadingSpinner from '../common/LoadingSpinner';
import AuthMethodConfig from './AuthMethodConfig';
import AuthMethodTune from './AuthMethodTune';
import RoleList from './RoleList';
import { AuthMethodMeta } from './AuthMethodMeta';

type Tab = 'Configuration' | 'Method Options' | 'Roles';
const TABS: Tab[] = ['Roles', 'Configuration', 'Method Options'];

export default function AuthMethodDetail() {
  const { method = '' } = useParams<{ method: string }>();
  const [activeTab, setActiveTab] = useState<Tab>('Roles');
  const [methodInfo, setMethodInfo] = useState<AuthMethod | null>(null);
  const [loading, setLoading] = useState(true);

  // Resolve the method type from the auth methods list
  useEffect(() => {
    api.getAuthMethods()
      .then((methods) => {
        const key = `${method}/`;
        const found = methods.find((m) => m.path === key || m.path === method);
        setMethodInfo(found ?? null);
      })
      .catch(() => setMethodInfo(null))
      .finally(() => setLoading(false));
  }, [method]);

  const authType = methodInfo?.type ?? method;

  return (
    <div>
      {/* Breadcrumb + header */}
      <div className="mb-1 flex items-center gap-1.5 text-sm text-gray-500">
        <Link to="/access/auth-methods" className="hover:text-[#1563ff]">Auth Methods</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">{method}</span>
      </div>

      <div className="mb-5">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-gray-900">{method}</h1>
          {loading
            ? <LoadingSpinner className="h-4 w-4" />
            : methodInfo && (
              <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                {authType}
              </span>
            )
          }
        </div>
        {methodInfo?.description && (
          <AuthMethodMeta description={methodInfo.description} />
        )}
      </div>

      {/* Tabs */}
      <div className="mb-6 border-b border-gray-200">
        <nav className="-mb-px flex gap-6">
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`whitespace-nowrap border-b-2 pb-3 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? 'border-[#1563ff] text-[#1563ff]'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'Configuration' && (
          <div className="rounded-lg border border-gray-200 bg-white p-6">
            <AuthMethodConfig method={method} authType={authType} />
          </div>
        )}
        {activeTab === 'Method Options' && (
          <div className="rounded-lg border border-gray-200 bg-white p-6">
            <AuthMethodTune method={method} />
          </div>
        )}
        {activeTab === 'Roles' && (
          <RoleList embedded />
        )}
      </div>
    </div>
  );
}
