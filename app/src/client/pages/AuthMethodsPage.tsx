import { Routes, Route } from 'react-router-dom';
import AuthMethodList from '../components/auth-methods/AuthMethodList';
import AuthMethodDetail from '../components/auth-methods/AuthMethodDetail';
import RoleDetail from '../components/auth-methods/RoleDetail';

export default function AuthMethodsPage() {
  return (
    <Routes>
      <Route index element={<AuthMethodList />} />
      <Route path=":method" element={<AuthMethodDetail />} />
      <Route path=":method/roles/:role" element={<RoleDetail />} />
    </Routes>
  );
}
