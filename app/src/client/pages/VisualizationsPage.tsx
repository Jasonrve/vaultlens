import { useState } from 'react';
import AuthPolicyGraph from '../components/graphs/AuthPolicyGraph';
import PolicySecretGraph from '../components/graphs/PolicySecretGraph';
import IdentityGraph from '../components/graphs/IdentityGraph';

const tabs = [
  { id: 'auth-policy', label: 'Auth → Role → Policy' },
  { id: 'policy-secret', label: 'Policy → Secret Path' },
  { id: 'identity', label: 'Identity' },
] as const;

type TabId = (typeof tabs)[number]['id'];

export default function VisualizationsPage() {
  const [activeTab, setActiveTab] = useState<TabId>('auth-policy');

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-gray-800">Visualizations</h1>

      <div className="mb-6 flex border-b border-gray-200">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'border-b-2 border-[#1563ff] text-[#1563ff]'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'auth-policy' && <AuthPolicyGraph />}
      {activeTab === 'policy-secret' && <PolicySecretGraph />}
      {activeTab === 'identity' && <IdentityGraph />}
    </div>
  );
}


