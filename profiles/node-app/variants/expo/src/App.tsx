import { StyleSheet, Text, View } from 'react-native';
import { greeting } from './greeting';

export default function App() {
  return (
    <View style={styles.container}>
      <Text>{greeting(null)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
