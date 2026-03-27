import { redirect } from 'next/navigation';
import { requireAdminSession } from '@/lib/authz';
import AdminConsole from '@/components/admin/AdminConsole';

export default async function AdminPage() {
  const session = await requireAdminSession();
  if (!session) {
    redirect('/');
  }

  return <AdminConsole />;
}
