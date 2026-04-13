import { Outlet } from 'react-router-dom';
import { useBrandingStore } from '../../stores/brandingStore';
import Sidebar from './Sidebar';
import Header from './Header';

export default function Layout() {
  const { branding } = useBrandingStore();

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main
          className="flex-1 overflow-y-auto p-6"
          style={{ backgroundColor: branding.backgroundColor }}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}

