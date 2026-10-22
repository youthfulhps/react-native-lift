import { LiftProvider } from 'react-native-lift';
import { FlatListScreen } from './poc/FlatListScreen';

export default function App() {
  return (
    <LiftProvider>
      <FlatListScreen />
    </LiftProvider>
  );
}
