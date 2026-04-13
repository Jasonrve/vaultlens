import { Routes, Route } from 'react-router-dom';
import EntityList from '../components/identity/EntityList';
import EntityDetail from '../components/identity/EntityDetail';
import GroupList from '../components/identity/GroupList';
import GroupDetail from '../components/identity/GroupDetail';

interface IdentityPageProps {
  type: 'entities' | 'groups';
}

export default function IdentityPage({ type }: IdentityPageProps) {
  if (type === 'groups') {
    return (
      <Routes>
        <Route index element={<GroupList />} />
        <Route path=":id" element={<GroupDetail />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route index element={<EntityList />} />
      <Route path=":id" element={<EntityDetail />} />
    </Routes>
  );
}
