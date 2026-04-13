import { Routes, Route } from 'react-router-dom';
import PolicyList from '../components/policies/PolicyList';
import PolicyDetail from '../components/policies/PolicyDetail';

export default function PoliciesPage() {
  return (
    <Routes>
      <Route index element={<PolicyList />} />
      <Route path=":name" element={<PolicyDetail />} />
    </Routes>
  );
}
