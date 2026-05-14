import AsyncStorage from '@react-native-async-storage/async-storage';

const K_ACCESS = 'bv_mobile_access_v1';
const K_REFRESH = 'bv_mobile_refresh_v1';

export async function saveTokens(access: string, refresh: string): Promise<void> {
  await AsyncStorage.multiSet([
    [K_ACCESS, access],
    [K_REFRESH, refresh],
  ]);
}

export async function clearTokens(): Promise<void> {
  await AsyncStorage.multiRemove([K_ACCESS, K_REFRESH]);
}

export async function getAccessToken(): Promise<string | null> {
  return AsyncStorage.getItem(K_ACCESS);
}

export async function getRefreshToken(): Promise<string | null> {
  return AsyncStorage.getItem(K_REFRESH);
}

export async function setAccessToken(access: string): Promise<void> {
  await AsyncStorage.setItem(K_ACCESS, access);
}
