import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const K_ACCESS = 'bv_mobile_access_v1';
const REFRESH_SECURE_KEY = 'bv_mobile_refresh_secure_v1';
/** Pre-secure-store refresh slot (migrated into SecureStore). */
const REFRESH_ASYNC_LEGACY = 'bv_mobile_refresh_v1';

async function writeRefresh(refresh: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(REFRESH_SECURE_KEY, refresh);
    await AsyncStorage.multiRemove([REFRESH_ASYNC_LEGACY]);
  } catch {
    await AsyncStorage.setItem(REFRESH_ASYNC_LEGACY, refresh);
  }
}

async function readRefresh(): Promise<string | null> {
  try {
    const secured = await SecureStore.getItemAsync(REFRESH_SECURE_KEY);
    if (secured) return secured;
  } catch {
    /* fall through */
  }

  const legacy = await AsyncStorage.getItem(REFRESH_ASYNC_LEGACY);
  if (legacy) {
    try {
      await SecureStore.setItemAsync(REFRESH_SECURE_KEY, legacy);
      await AsyncStorage.removeItem(REFRESH_ASYNC_LEGACY);
    } catch {
      /* keep legacy copy */
    }
    return legacy;
  }
  return null;
}

async function deleteRefresh(): Promise<void> {
  await AsyncStorage.removeItem(REFRESH_ASYNC_LEGACY);
  try {
    await SecureStore.deleteItemAsync(REFRESH_SECURE_KEY);
  } catch {
    /* ignore */
  }
}

export async function saveTokens(access: string, refresh: string): Promise<void> {
  await AsyncStorage.setItem(K_ACCESS, access);
  await writeRefresh(refresh);
}

export async function clearTokens(): Promise<void> {
  await AsyncStorage.removeItem(K_ACCESS);
  await deleteRefresh();
}

export async function getAccessToken(): Promise<string | null> {
  return AsyncStorage.getItem(K_ACCESS);
}

export async function getRefreshToken(): Promise<string | null> {
  return readRefresh();
}

export async function setAccessToken(access: string): Promise<void> {
  await AsyncStorage.setItem(K_ACCESS, access);
}
