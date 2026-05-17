// Placeholder home screen — replaced by GardenDashboard at §16 step 10.
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useAuthStore } from '../../store/authStore';

export default function HomeScreen() {
  const logout = useAuthStore((s) => s.logout);
  const userId = useAuthStore((s) => s.userId);

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Connected</Text>
      <Text style={styles.sub}>User: {userId}</Text>
      <TouchableOpacity style={styles.button} onPress={() => void logout()}>
        <Text style={styles.buttonText}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    gap: 16,
  },
  heading: { fontSize: 24, fontWeight: '700', color: '#1a1a1a' },
  sub: { fontSize: 14, color: '#6b7280' },
  button: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  buttonText: { fontSize: 15, color: '#374151' },
});
