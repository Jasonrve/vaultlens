import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import * as api from '../../lib/api';
import type { Group } from '../../types';
import LoadingSpinner from '../common/LoadingSpinner';
import ErrorMessage from '../common/ErrorMessage';
import Badge from '../common/Badge';
import RelationshipGraphModal from '../common/RelationshipGraphModal';

export default function GroupDetail() {
  const { id = '' } = useParams();
  const [group, setGroup] = useState<Group | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showGraph, setShowGraph] = useState(false);

  useEffect(() => {
    api
      .getGroup(id)
      .then(setGroup)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'An error occurred'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <LoadingSpinner className="mt-12" />;
  if (error) return <ErrorMessage message={error} />;
  if (!group) return <ErrorMessage message="Group not found" />;

  return (
    <div>
      {showGraph && group && (
        <RelationshipGraphModal
          entityType="group"
          entityId={group.id}
          entityLabel={group.name}
          onClose={() => setShowGraph(false)}
        />
      )}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/access/groups" className="text-sm text-[#1563ff] hover:text-[#1250d4]">
            ← Groups
          </Link>
          <h1 className="text-2xl font-bold text-gray-800">{group.name}</h1>
          <Badge text={group.type || 'internal'} />
        </div>
        <button
          onClick={() => setShowGraph(true)}
          title="View relationship graph"
          className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 shadow-sm hover:bg-gray-50 hover:text-[#1563ff]"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
            <circle cx="6" cy="12" r="2" />
            <circle cx="18" cy="6" r="2" />
            <circle cx="18" cy="18" r="2" />
            <path strokeLinecap="round" d="M8 11.2l8-4" />
            <path strokeLinecap="round" d="M8 12.8l8 4" />
          </svg>
          Relationships
        </button>
      </div>

      <div className="space-y-6">
        {/* Info */}
        <div className="rounded-md border border-gray-200 bg-white">
          <div className="border-b border-gray-200 bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-600">
            Details
          </div>
          <div className="divide-y divide-gray-100">
            <div className="flex px-4 py-3">
              <span className="w-1/4 text-sm font-medium text-gray-500">ID</span>
              <span className="font-mono text-sm text-gray-700">{group.id}</span>
            </div>
            <div className="flex px-4 py-3">
              <span className="w-1/4 text-sm font-medium text-gray-500">Name</span>
              <span className="text-sm text-gray-700">{group.name}</span>
            </div>
            <div className="flex px-4 py-3">
              <span className="w-1/4 text-sm font-medium text-gray-500">Type</span>
              <span className="text-sm text-gray-700">{group.type || 'internal'}</span>
            </div>
          </div>
        </div>

        {/* Policies */}
        <div className="rounded-md border border-gray-200 bg-white">
          <div className="border-b border-gray-200 bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-600">
            Policies
          </div>
          <div className="flex flex-wrap gap-2 p-4">
            {group.policies?.length ? (
              group.policies.map((p) => (
                <Link key={p} to={`/policies/${p}`}>
                  <Badge text={p} variant="read" />
                </Link>
              ))
            ) : (
              <span className="text-sm text-gray-400">No policies attached</span>
            )}
          </div>
        </div>

        {/* Members */}
        <div className="rounded-md border border-gray-200 bg-white">
          <div className="border-b border-gray-200 bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-600">
            Member Entities
          </div>
          <div className="flex flex-wrap gap-2 p-4">
            {group.member_entity_ids?.length ? (
              group.member_entity_ids.map((eid) => (
                <Link key={eid} to={`/access/entities/${eid}`}>
                  <Badge text={eid} variant="write" />
                </Link>
              ))
            ) : (
              <span className="text-sm text-gray-400">No member entities</span>
            )}
          </div>
        </div>

        {/* Sub-groups */}
        {group.member_group_ids?.length > 0 && (
          <div className="rounded-md border border-gray-200 bg-white">
            <div className="border-b border-gray-200 bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-600">
              Member Groups
            </div>
            <div className="flex flex-wrap gap-2 p-4">
              {group.member_group_ids.map((gid) => (
                <Link key={gid} to={`/access/groups/${gid}`}>
                  <Badge text={gid} variant="list" />
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

