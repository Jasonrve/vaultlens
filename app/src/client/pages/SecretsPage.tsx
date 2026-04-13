import { Routes, Route } from 'react-router-dom';
import SecretsEngineList from '../components/secrets/SecretsEngineList';
import SecretsList from '../components/secrets/SecretsList';
import SecretView from '../components/secrets/SecretView';
import SecretEditor from '../components/secrets/SecretEditor';
import SecretMergeEditor from '../components/secrets/SecretMergeEditor';

export default function SecretsPage() {
  return (
    <Routes>
      <Route index element={<SecretsEngineList />} />
      <Route path="view/*" element={<SecretView />} />
      <Route path="edit/*" element={<SecretEditor />} />
      <Route path="create/*" element={<SecretEditor />} />
      <Route path="merge/*" element={<SecretMergeEditor />} />
      <Route path="*" element={<SecretsList />} />
    </Routes>
  );
}
